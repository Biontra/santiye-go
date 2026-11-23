-- Migration 24: seller_id NULL hatası düzeltmesi
-- Sorun: get_or_create_conversation, companies.user_id NULL ise seller_id'yi
-- company UUID olarak kaydediyor. send_message_rpc katılımcı kontrolünde
-- auth.uid() != NULL her zaman TRUE → RAISE EXCEPTION → mesaj yazılmıyor.
-- Düzeltme 1: get_or_create_conversation — user_id NULL ise EXCEPTION at, geçiştirme.
-- Düzeltme 2: send_message_rpc — seller_id NULL kontrolü NULL-safe yapıldı.

-- ============================================================
-- 1. get_or_create_conversation: seller_id fallback düzeltmesi
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(
    p_listing_id UUID DEFAULT NULL,
    p_company_id UUID DEFAULT NULL,
    p_quote_request_id UUID DEFAULT NULL,
    p_initial_message TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_user_id UUID;
    v_seller_user_id UUID;
    v_resolved_company_id UUID;
    v_listing_title TEXT;
    v_existing_id UUID;
    v_new_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_conv_count_min INT;
    v_conv_count_day INT;
    v_send_res jsonb;
BEGIN
    v_current_user_id := auth.uid();
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Konuşma başlatmak için giriş yapmalısınız.';
    END IF;

    -- 1. İlan ID'si verilmişse ilan üzerinden satıcıyı ve şirketi çözümle
    IF p_listing_id IS NOT NULL THEN
        SELECT l.company_id, l.title, c.user_id
        INTO v_resolved_company_id, v_listing_title, v_seller_user_id
        FROM public.listings l
        LEFT JOIN public.companies c ON c.id = l.company_id
        WHERE l.id = p_listing_id;

        IF v_resolved_company_id IS NULL THEN
            RAISE EXCEPTION 'Belirtilen ilan bulunamadı.';
        END IF;

        -- DÜZELTİLDİ: user_id NULL ise company UUID ile geçiştirme, hata ver.
        IF v_seller_user_id IS NULL THEN
            RAISE EXCEPTION 'Bu ilanın sahibi firma henüz hesap doğrulamasını tamamlamamış. Lütfen daha sonra tekrar deneyin.';
        END IF;

    ELSIF p_company_id IS NOT NULL THEN
        SELECT c.id, c.user_id
        INTO v_resolved_company_id, v_seller_user_id
        FROM public.companies c
        WHERE c.id = p_company_id OR c.user_id = p_company_id
        LIMIT 1;

        IF v_resolved_company_id IS NULL THEN
            RAISE EXCEPTION 'Belirtilen firma bulunamadı.';
        END IF;

        -- DÜZELTİLDİ: user_id NULL ise hata ver.
        IF v_seller_user_id IS NULL THEN
            RAISE EXCEPTION 'Bu firmanın sahibi henüz hesap doğrulamasını tamamlamamış. Lütfen daha sonra tekrar deneyin.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Konuşma başlatmak için bir ilan veya firma belirtilmelidir.';
    END IF;

    -- 2. Kendi ilanına / kendine mesaj başlatma engeli
    IF v_current_user_id = v_seller_user_id THEN
        RAISE EXCEPTION 'Kendi ilanınıza veya kendinize mesaj gönderemezsiniz.';
    END IF;

    -- 3. Engellenen kullanıcı denetimi
    IF EXISTS (
        SELECT 1 FROM public.user_blocks
        WHERE (blocker_id = v_current_user_id AND blocked_id = v_seller_user_id)
           OR (blocker_id = v_seller_user_id AND blocked_id = v_current_user_id)
    ) THEN
        RAISE EXCEPTION 'Engelleme nedeniyle bu kullanıcıyla konuşma başlatılamaz.';
    END IF;

    -- 4. Mevcut konuşmayı ara
    SELECT id INTO v_existing_id
    FROM public.conversations
    WHERE buyer_id = v_current_user_id
      AND (seller_id = v_seller_user_id OR company_id = v_resolved_company_id)
      AND (
          (p_listing_id IS NOT NULL AND listing_id = p_listing_id)
          OR (p_listing_id IS NULL AND listing_id IS NULL AND quote_request_id IS NOT DISTINCT FROM p_quote_request_id)
      )
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        -- Eksik seller_id varsa güncelle
        UPDATE public.conversations
        SET seller_id = v_seller_user_id
        WHERE id = v_existing_id AND seller_id IS NULL;

        IF p_initial_message IS NOT NULL AND length(trim(p_initial_message)) > 0 THEN
            v_send_res := public.send_message_rpc(
                p_conversation_id := v_existing_id,
                p_content := p_initial_message
            );
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'conversation_id', v_existing_id,
            'is_new', false,
            'initial_message_result', v_send_res
        );
    END IF;

    -- 5. Hız sınırı denetimi
    SELECT COUNT(*) INTO v_conv_count_min
    FROM public.conversations
    WHERE buyer_id = v_current_user_id AND created_at > (v_now - INTERVAL '1 minute');

    IF v_conv_count_min >= 5 THEN
        RAISE EXCEPTION 'Çok hızlı konuşma başlatıyorsunuz. Lütfen 1 dakika bekleyiniz.';
    END IF;

    SELECT COUNT(*) INTO v_conv_count_day
    FROM public.conversations
    WHERE buyer_id = v_current_user_id AND created_at > (v_now - INTERVAL '1 day');

    IF v_conv_count_day >= 50 THEN
        RAISE EXCEPTION 'Günlük yeni konuşma limitinize ulaştınız.';
    END IF;

    -- 6. Yeni konuşmayı ekle
    INSERT INTO public.conversations (
        id,
        buyer_id,
        seller_id,
        company_id,
        listing_id,
        quote_request_id,
        last_message_at,
        created_at,
        updated_at
    ) VALUES (
        gen_random_uuid(),
        v_current_user_id,
        v_seller_user_id,
        v_resolved_company_id,
        p_listing_id,
        p_quote_request_id,
        v_now,
        v_now,
        v_now
    )
    ON CONFLICT (buyer_id, seller_id, listing_id) WHERE listing_id IS NOT NULL
    DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_new_id;

    IF v_new_id IS NULL THEN
        SELECT id INTO v_new_id
        FROM public.conversations
        WHERE buyer_id = v_current_user_id
          AND seller_id = v_seller_user_id
          AND listing_id = p_listing_id;
    END IF;

    -- 7. Başlangıç mesajı gönder
    IF p_initial_message IS NOT NULL AND length(trim(p_initial_message)) > 0 THEN
        v_send_res := public.send_message_rpc(
            p_conversation_id := v_new_id,
            p_content := p_initial_message
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'conversation_id', v_new_id,
        'is_new', true,
        'initial_message_result', v_send_res
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID, UUID, UUID, TEXT) TO authenticated;

-- ============================================================
-- 2. send_message_rpc: seller_id NULL kontrolü NULL-safe yap
--    + Mevcut conversations'taki bozuk seller_id'leri düzelt
-- ============================================================

-- Mevcut conversations'ta seller_id = company_id olan (yanlış set edilmiş) kayıtları düzelt
UPDATE public.conversations c
SET seller_id = co.user_id
FROM public.companies co
WHERE c.seller_id = c.company_id       -- seller_id yanlışlıkla company UUID'si
  AND co.id = c.company_id
  AND co.user_id IS NOT NULL
  AND co.user_id != c.buyer_id;

-- send_message_rpc: katılımcı kontrolünü NULL-safe yap
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
    v_recipient_email_pref JSONB;
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

    -- seller_id NULL ise şirket sahibinden güncelle
    IF v_conv.seller_id IS NULL AND v_conv.company_owner_id IS NOT NULL THEN
        UPDATE public.conversations SET seller_id = v_conv.company_owner_id WHERE id = v_conv.id;
        v_conv.seller_id := v_conv.company_owner_id;
    END IF;

    -- DÜZELTİLDİ: NULL-safe katılımcı kontrolü (IS DISTINCT FROM)
    IF v_sender_id IS DISTINCT FROM v_conv.buyer_id AND v_sender_id IS DISTINCT FROM v_conv.seller_id THEN
        RAISE EXCEPTION 'Bu konuşmaya mesaj gönderme yetkiniz bulunmamaktadır.';
    END IF;

    -- Alıcı kimliğini belirle
    IF v_sender_id = v_conv.buyer_id THEN
        v_recipient_id := v_conv.seller_id;
    ELSE
        v_recipient_id := v_conv.buyer_id;
    END IF;

    -- 2. Engelleme kontrolü
    IF EXISTS (
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

    -- 5. Hız Sınırı Denetimi
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

    IF v_is_masked THEN
        INSERT INTO public.compliance_mask_logs (
            user_id, entity_type, entity_id, detected_types, created_at
        ) VALUES (
            v_sender_id, 'message', p_conversation_id::text,
            ARRAY(SELECT jsonb_array_elements_text(v_detected_types)), v_now
        );

        UPDATE public.profiles
        SET mask_violation_count = COALESCE(mask_violation_count, 0) + 1
        WHERE id = v_sender_id;
    END IF;

    -- 7. Mesajı Veritabanına Ekle
    INSERT INTO public.messages (
        id, conversation_id, sender_id, content,
        attachment_url, client_message_id, is_read, created_at
    ) VALUES (
        gen_random_uuid(), p_conversation_id, v_sender_id, v_clean_content,
        p_attachment_url, p_client_message_id, false, v_now
    )
    RETURNING * INTO v_new_msg;

    -- 8. Konuşmanın son mesaj zamanını güncelle
    UPDATE public.conversations
    SET last_message_at = v_now, updated_at = v_now
    WHERE id = p_conversation_id;

    -- 9. Alıcıya Uygulama İçi Bildirim
    INSERT INTO public.notifications (
        id, user_id, type, title, content, link_url, is_read, created_at
    ) VALUES (
        gen_random_uuid(), v_recipient_id, 'new_message', 'Yeni Mesaj',
        'İlanınızla ilgili yeni bir mesaj aldınız.',
        '/mesajlar?conv=' || p_conversation_id, false, v_now
    );

    -- 10. E-posta Bildirim Kısıtlaması
    INSERT INTO public.message_email_notifications (
        recipient_id, conversation_id, last_sent_at, pending_count, created_at
    ) VALUES (
        v_recipient_id, p_conversation_id, v_now, 1, v_now
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
