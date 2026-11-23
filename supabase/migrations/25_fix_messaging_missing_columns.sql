-- Migration 25: Mesajlaşma eksik kolonlar ve RPC güvenlik düzeltmesi
-- 1. public.messages tablosuna attachment_url kolonu eklenir (EKSİKTİ: send_message_rpc INSERT'i bu yüzden patlıyordu!)
-- 2. public.profiles tablosuna mask_violation_count kolonu eklenir (EKSİKTİ: maskeleme logu profili güncellerken patlıyordu!)
-- 3. send_message_rpc: v_recipient_id NULL olduğunda notifications/email INSERT'lerinin NOT NULL constraint patlatması önlendi.
-- 4. PostgREST şema önbelleği yenilenir.

-- 1. Kolonları Ekle
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mask_violation_count INT DEFAULT 0;

-- 2. send_message_rpc Fonksiyonunu Güncelle
CREATE OR REPLACE FUNCTION public.send_message_rpc(
    p_conversation_id UUID,
    p_content TEXT,
    p_attachment_url TEXT DEFAULT NULL,
    p_client_message_id TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sender_id UUID;
    v_conv RECORD;
    v_recipient_id UUID;
    v_clean_content TEXT;
    v_mask_res jsonb;
    v_is_masked BOOLEAN := false;
    v_detected_types jsonb := '[]'::jsonb;
    v_msg_count_min INT;
    v_msg_count_day INT;
    v_new_msg RECORD;
    v_existing_msg_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_throttle_minutes INT := 15;
    v_should_email BOOLEAN := false;
BEGIN
    v_sender_id := auth.uid();
    IF v_sender_id IS NULL THEN
        RAISE EXCEPTION 'Mesaj göndermek için giriş yapmalısınız.';
    END IF;

    -- 1. Konuşmayı doğrula ve katılımcı kontrolü yap
    SELECT c.*, co.user_id AS company_owner_id
    INTO v_conv
    FROM public.conversations c
    LEFT JOIN public.companies co ON co.id = c.company_id
    WHERE c.id = p_conversation_id;

    IF v_conv.id IS NULL THEN
        RAISE EXCEPTION 'Konuşma bulunamadı.';
    END IF;

    -- Eğer seller_id henüz NULL ise ve şirket sahibi varsa güncelle
    IF v_conv.seller_id IS NULL AND v_conv.company_owner_id IS NOT NULL THEN
        UPDATE public.conversations SET seller_id = v_conv.company_owner_id WHERE id = v_conv.id;
        v_conv.seller_id := v_conv.company_owner_id;
    END IF;

    -- Yetki kontrolü: Sadece alıcı veya satıcı mesaj gönderebilir
    IF v_sender_id IS DISTINCT FROM v_conv.buyer_id AND v_sender_id IS DISTINCT FROM v_conv.seller_id THEN
        RAISE EXCEPTION 'Bu konuşmaya mesaj gönderme yetkiniz bulunmamaktadır.';
    END IF;

    -- Alıcı kimliğini belirle
    IF v_sender_id = v_conv.buyer_id THEN
        v_recipient_id := v_conv.seller_id;
    ELSE
        v_recipient_id := v_conv.buyer_id;
    END IF;

    -- 2. Engelleme kontrolü (v_recipient_id varsa)
    IF v_recipient_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_blocks
        WHERE (blocker_id = v_sender_id AND blocked_id = v_recipient_id)
           OR (blocker_id = v_recipient_id AND blocked_id = v_sender_id)
    ) THEN
        RAISE EXCEPTION 'Engelleme nedeniyle bu kullanıcıya mesaj gönderilemez.';
    END IF;

    -- 3. Çift gönderim kontrolü (idempotency)
    IF p_client_message_id IS NOT NULL AND length(trim(p_client_message_id)) > 0 THEN
        SELECT id INTO v_existing_msg_id
        FROM public.messages
        WHERE conversation_id = p_conversation_id AND client_message_id = p_client_message_id;

        IF v_existing_msg_id IS NOT NULL THEN
            SELECT * INTO v_new_msg FROM public.messages WHERE id = v_existing_msg_id;
            RETURN jsonb_build_object(
                'success', true,
                'message', to_jsonb(v_new_msg),
                'is_duplicate', true
            );
        END IF;
    END IF;

    -- 4. İçerik ve Uzunluk Doğrulaması
    v_clean_content := trim(COALESCE(p_content, ''));
    v_clean_content := regexp_replace(v_clean_content, '<[^>]+>', '', 'g');

    IF length(v_clean_content) = 0 AND (p_attachment_url IS NULL OR length(trim(p_attachment_url)) = 0) THEN
        RAISE EXCEPTION 'Mesaj içeriği boş olamaz.';
    END IF;

    IF length(v_clean_content) > 2000 THEN
        RAISE EXCEPTION 'Mesaj uzunluğu 2000 karakter sınırını aşamaz.';
    END IF;

    -- 5. Hız Sınırı Denetimi (Dakikada maks 20, günde maks 500)
    SELECT COUNT(*) INTO v_msg_count_min
    FROM public.messages
    WHERE sender_id = v_sender_id AND created_at > (v_now - INTERVAL '1 minute');

    IF v_msg_count_min >= 20 THEN
        RAISE EXCEPTION 'Çok hızlı mesaj gönderiyorsunuz. Lütfen biraz bekleyiniz.';
    END IF;

    SELECT COUNT(*) INTO v_msg_count_day
    FROM public.messages
    WHERE sender_id = v_sender_id AND created_at > (v_now - INTERVAL '1 day');

    IF v_msg_count_day >= 500 THEN
        RAISE EXCEPTION 'Günlük mesaj gönderme limitinize ulaştınız.';
    END IF;

    -- 6. Sunucu Tarafı 9A İletişim Maskelemesi
    v_mask_res := public.mask_contact_info(v_clean_content);
    v_clean_content := v_mask_res->>'sanitized_text';
    v_is_masked := (v_mask_res->>'is_masked')::boolean;
    v_detected_types := v_mask_res->'detected_types';

    -- Maskeleme gerçekleştiyse logla ve profilde ihlal sayacını artır
    IF v_is_masked THEN
        INSERT INTO public.compliance_mask_logs (
            user_id,
            entity_type,
            entity_id,
            detected_types,
            created_at
        ) VALUES (
            v_sender_id,
            'message',
            p_conversation_id::text,
            ARRAY(SELECT jsonb_array_elements_text(v_detected_types)),
            v_now
        );

        UPDATE public.profiles
        SET mask_violation_count = COALESCE(mask_violation_count, 0) + 1
        WHERE id = v_sender_id;
    END IF;

    -- 7. Mesajı Veritabanına Ekle
    INSERT INTO public.messages (
        id,
        conversation_id,
        sender_id,
        content,
        attachment_url,
        client_message_id,
        is_read,
        created_at
    ) VALUES (
        gen_random_uuid(),
        p_conversation_id,
        v_sender_id,
        v_clean_content,
        p_attachment_url,
        p_client_message_id,
        false,
        v_now
    )
    RETURNING * INTO v_new_msg;

    -- 8. Konuşmanın son mesaj zamanını güncelle
    UPDATE public.conversations
    SET last_message_at = v_now,
        updated_at = v_now
    WHERE id = p_conversation_id;

    -- 9. Alıcıya Uygulama İçi Bildirim Ekle (v_recipient_id NULL değilse)
    IF v_recipient_id IS NOT NULL THEN
        INSERT INTO public.notifications (
            id,
            user_id,
            type,
            title,
            content,
            link_url,
            is_read,
            created_at
        ) VALUES (
            gen_random_uuid(),
            v_recipient_id,
            'new_message',
            'Yeni Mesaj',
            'İlanınızla ilgili yeni bir mesaj aldınız.',
            '/mesajlar?conv=' || p_conversation_id,
            false,
            v_now
        );

        -- 10. E-posta Bildirim Kısıtlaması (Throttling) Hesaplama
        INSERT INTO public.message_email_notifications (
            recipient_id,
            conversation_id,
            last_sent_at,
            pending_count,
            created_at
        ) VALUES (
            v_recipient_id,
            p_conversation_id,
            v_now,
            1,
            v_now
        )
        ON CONFLICT (recipient_id, conversation_id) DO UPDATE SET
            pending_count = CASE 
                WHEN public.message_email_notifications.last_sent_at < (v_now - (v_throttle_minutes || ' minutes')::interval) THEN 1
                ELSE public.message_email_notifications.pending_count + 1
            END,
            last_sent_at = CASE 
                WHEN public.message_email_notifications.last_sent_at < (v_now - (v_throttle_minutes || ' minutes')::interval) THEN v_now
                ELSE public.message_email_notifications.last_sent_at
            END
        RETURNING (last_sent_at = v_now AND pending_count = 1) INTO v_should_email;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', to_jsonb(v_new_msg),
        'is_masked', v_is_masked,
        'info_notice', CASE 
            WHEN v_is_masked THEN 'İletişim bilgisi tespit edildi ve maskelendi. Teklif onaylandıktan sonra bilgiler her iki tarafa otomatik paylaşılacaktır.'
            ELSE NULL 
        END,
        'email_notification', jsonb_build_object(
            'should_send', v_should_email,
            'recipient_id', v_recipient_id
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_message_rpc(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- PostgREST şema önbelleğini yenile
NOTIFY pgrst, 'reload schema';
