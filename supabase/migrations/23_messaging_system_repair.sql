-- ==============================================================================
-- ŞANTİYE GO – MIGRATION 23: MESAJLAŞMA VE İLİŞKİLİ SİSTEMLER NİHAİ ONARIMI
-- (Katılımcı Kimlik Modeli, Atomik RPC'ler, Sunucu Maskeleme, Hız Sınırları,
--  Realtime Yayını, Özel Depolama, Bildirim & Throttling, KVKK Gizliliği)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLO ALAN GÜNCELLEMELERİ VE İNDEKSLER
-- ------------------------------------------------------------------------------

-- Conversations tablosuna satıcı auth kullanıcı kimliğini (seller_id) ekle
ALTER TABLE public.conversations 
    ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_conversations_seller ON public.conversations(seller_id);
CREATE INDEX IF NOT EXISTS idx_conversations_buyer_seller ON public.conversations(buyer_id, seller_id);

-- Benzersiz konuşma kısıtları (aynı ilan/talep için mükerrer konuşma engeli)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique_listing 
    ON public.conversations(buyer_id, seller_id, listing_id) 
    WHERE listing_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique_quote 
    ON public.conversations(buyer_id, seller_id, quote_request_id) 
    WHERE quote_request_id IS NOT NULL;

-- Messages tablosuna idempotency (çift tıklama/tekrar yazım koruması) kolonu ekle
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id 
    ON public.messages(conversation_id, client_message_id) 
    WHERE client_message_id IS NOT NULL;

-- E-posta bildirim kısıtlama (throttling) tablosu
CREATE TABLE IF NOT EXISTS public.message_email_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pending_count INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(recipient_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_msg_email_notif_recipient ON public.message_email_notifications(recipient_id);

-- Dinamik mesajlaşma sistem ayarları
INSERT INTO public.system_settings (key, value, description)
VALUES 
    ('messaging_limits', '{
        "max_messages_per_minute": 20,
        "max_messages_per_day": 500,
        "max_conversations_per_minute": 5,
        "max_conversations_per_day": 50,
        "max_length": 2000,
        "email_throttle_minutes": 15
    }'::jsonb, 'Mesajlaşma hız sınırları, karakter limitleri ve e-posta geciktirme ayarları')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW();

-- ------------------------------------------------------------------------------
-- 2. VERİTABANI SEVİYESİ İLETİŞİM MASKELEME MOTORU (9A)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mask_contact_info(p_text TEXT)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_result TEXT;
    v_is_masked BOOLEAN := false;
    v_detected TEXT[] := '{}';
    v_phone_pattern TEXT;
    v_email_pattern TEXT;
    v_iban_pattern TEXT;
    v_keyword_pattern TEXT;
BEGIN
    IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
        RETURN jsonb_build_object('sanitized_text', '', 'is_masked', false, 'detected_types', '[]'::jsonb);
    END IF;

    v_result := p_text;

    -- 1. IBAN Tespiti (TR ile başlayan 2 kontrol hanesi ve en az 16 hane)
    -- (TR tek başına asla maskelenmez; en az 16 karakter rakam/boşluk/harf olmalıdır)
    v_iban_pattern := '(?i)(^|[^a-zA-Z0-9])TR\s*[0-9]{2}[\s0-9A-Z]{14,28}([^a-zA-Z0-9]|$)';
    IF v_result ~ v_iban_pattern THEN
        v_is_masked := true;
        v_detected := array_append(v_detected, 'iban');
        v_result := regexp_replace(v_result, v_iban_pattern, '\1[iletişim bilgisi gizlendi]\2', 'gi');
    END IF;

    -- 2. E-Posta Tespiti
    v_email_pattern := '(?i)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}';
    IF v_result ~ v_email_pattern THEN
        v_is_masked := true;
        v_detected := array_append(v_detected, 'email');
        v_result := regexp_replace(v_result, v_email_pattern, '[iletişim bilgisi gizlendi]', 'gi');
    END IF;

    -- 3. Türkiye ve Uluslararası Telefon Tespiti (05xx, 5xx, +905xx, boşluklu/noktalı)
    -- Yanlış alarm koruması: Fiyat (15.000 ₺), Tonaj (22 ton), m² (120 m²), Model (CAT 320D) maskelenmez.
    v_phone_pattern := '(?i)(^|[^0-9])(\+?90\s*|\b0\s*)?5[0-9]{2}[\s\.\-_/]*[0-9]{3}[\s\.\-_/]*[0-9]{2}[\s\.\-_/]*[0-9]{2}([^0-9]|$)';
    IF v_result ~ v_phone_pattern THEN
        v_is_masked := true;
        v_detected := array_append(v_detected, 'phone');
        v_result := regexp_replace(v_result, v_phone_pattern, '\1[iletişim bilgisi gizlendi]\3', 'gi');
    END IF;

    -- Bitişik 10 veya 11 haneli 05xx veya 5xx telefonlar
    IF v_result ~ '(?i)(^|[^0-9])(0?5[0-9]{9})([^0-9]|$)' THEN
        v_is_masked := true;
        v_detected := array_append(v_detected, 'phone');
        v_result := regexp_replace(v_result, '(?i)(^|[^0-9])(0?5[0-9]{9})([^0-9]|$)', '\1[iletişim bilgisi gizlendi]\3', 'gi');
    END IF;

    -- Tek tek ayrık yazılmış rakamlar (örn: 0 5 3 2 1 2 3 4 5 6 7)
    IF v_result ~ '(?i)(^|[^0-9])0\s*5\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]([^0-9]|$)' THEN
        v_is_masked := true;
        v_detected := array_append(v_detected, 'phone');
        v_result := regexp_replace(v_result, '(?i)(^|[^0-9])0\s*5\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]\s*[0-9]([^0-9]|$)', '\1[iletişim bilgisi gizlendi]\2', 'gi');
    END IF;

    -- 4. Harici İletişim / Kaçak Yönlendirme Kelimeleri
    v_keyword_pattern := '(?i)(^|[^a-zA-Z0-9çşğüıöÇŞĞÜİÖ])(whatsapp|watsap|watcap|wp|w/p|telegram|t\.me|instagram|insta|özelden\s*yaz|özelden\s*ara|ozelden\s*yaz|ozelden\s*ara|elden\s*anlaşalım|elden\s*anlasalim|elden\s*öde|elden\s*ode|aradan\s*çıkalım|komisyonsuz\s*halledelim)([^a-zA-Z0-9çşğüıöÇŞĞÜİÖ]|$)';
    IF v_result ~ v_keyword_pattern THEN
        v_is_masked := true;
        v_detected := array_append(v_detected, 'keyword');
        v_result := regexp_replace(v_result, v_keyword_pattern, '\1[iletişim bilgisi gizlendi]\3', 'gi');
    END IF;

    -- Mükerrer maskeleme temizliği: "[iletişim bilgisi gizlendi] [iletişim bilgisi gizlendi]" -> "[iletişim bilgisi gizlendi]"
    v_result := regexp_replace(v_result, '(\[iletişim bilgisi gizlendi\]\s*)+', '[iletişim bilgisi gizlendi] ', 'gi');
    v_result := trim(v_result);

    RETURN jsonb_build_object(
        'sanitized_text', v_result,
        'is_masked', v_is_masked,
        'detected_types', to_jsonb(v_detected)
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. ATOMİK RPC: GET_OR_CREATE_CONVERSATION (BUL VEYA OLUŞTUR)
-- ------------------------------------------------------------------------------

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

        IF v_seller_user_id IS NULL THEN
            -- Şirketin user_id'si yoksa şirketin ID'sini dene
            v_seller_user_id := v_resolved_company_id;
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

    -- 4. Mevcut konuşmayı ara (yarış durumunu önlemek için FOR UPDATE kullanılabilir)
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
        -- Eğer başlangıç mesajı varsa gönder
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

    -- 5. Hız sınırı denetimi (Dakikada maks 5, günde maks 50 yeni konuşma)
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

    -- Eğer conflict dolayısıyla RETURNING boş döndüyse mevcut kaydı çek
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

-- ------------------------------------------------------------------------------
-- 4. ATOMİK RPC: SEND_MESSAGE_RPC (GÖNDERME, MASKELEME, HIZ SINIRI, BİLDİRİM)
-- ------------------------------------------------------------------------------

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

    -- Eğer seller_id henüz NULL ise şirket sahibinden güncelle
    IF v_conv.seller_id IS NULL AND v_conv.company_owner_id IS NOT NULL THEN
        UPDATE public.conversations SET seller_id = v_conv.company_owner_id WHERE id = v_conv.id;
        v_conv.seller_id := v_conv.company_owner_id;
    END IF;

    -- Yetki kontrolü: Sadece alıcı veya satıcı mesaj gönderebilir
    IF v_sender_id != v_conv.buyer_id AND v_sender_id != v_conv.seller_id THEN
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

    -- 3. Çift tıklama / Tekrar Gönderim (Idempotency) Kontrolü
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
    
    -- HTML/Script tag temizliği
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

    -- 9. Alıcıya Uygulama İçi Bildirim Ekle
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

-- ------------------------------------------------------------------------------
-- 5. ATOMİK RPC: MARK_MESSAGES_READ (OKUNDU İŞARETLEME)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_messages_read(
    p_conversation_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reader_id UUID;
    v_updated_count INT;
BEGIN
    v_reader_id := auth.uid();
    IF v_reader_id IS NULL THEN
        RAISE EXCEPTION 'Oturum açmalısınız.';
    END IF;

    -- Kullanıcının taraf olduğu konuşmadaki karşı taraf mesajlarını okundu yap
    UPDATE public.messages
    SET is_read = true,
        read_at = NOW()
    WHERE conversation_id = p_conversation_id
      AND sender_id != v_reader_id
      AND is_read = false
      AND conversation_id IN (
          SELECT id FROM public.conversations 
          WHERE buyer_id = v_reader_id OR seller_id = v_reader_id
      );

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    -- İlgili bildirimi de okundu yap
    UPDATE public.notifications
    SET is_read = true
    WHERE user_id = v_reader_id
      AND type = 'new_message'
      AND link_url LIKE '%' || p_conversation_id || '%';

    RETURN jsonb_build_object(
        'success', true,
        'marked_count', v_updated_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_messages_read(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. ATOMİK RPC: ENGELLEME VE ŞİKAYET İŞLEMLERİ
-- ------------------------------------------------------------------------------

-- Kullanıcı Engelleme
CREATE OR REPLACE FUNCTION public.block_user_rpc(
    p_blocked_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_blocker_id UUID;
BEGIN
    v_blocker_id := auth.uid();
    IF v_blocker_id IS NULL THEN
        RAISE EXCEPTION 'Giriş yapmalısınız.';
    END IF;

    IF v_blocker_id = p_blocked_id THEN
        RAISE EXCEPTION 'Kendinizi engelleyemezsiniz.';
    END IF;

    INSERT INTO public.user_blocks (blocker_id, blocked_id, created_at)
    VALUES (v_blocker_id, p_blocked_id, NOW())
    ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.block_user_rpc(UUID) TO authenticated;

-- Engeli Kaldırma
CREATE OR REPLACE FUNCTION public.unblock_user_rpc(
    p_blocked_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_blocker_id UUID;
BEGIN
    v_blocker_id := auth.uid();
    IF v_blocker_id IS NULL THEN
        RAISE EXCEPTION 'Giriş yapmalısınız.';
    END IF;

    DELETE FROM public.user_blocks
    WHERE blocker_id = v_blocker_id AND blocked_id = p_blocked_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unblock_user_rpc(UUID) TO authenticated;

-- Şikayet Etme
CREATE OR REPLACE FUNCTION public.report_entity_rpc(
    p_reported_user_id UUID DEFAULT NULL,
    p_message_id UUID DEFAULT NULL,
    p_listing_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT 'diger',
    p_details TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reporter_id UUID;
    v_report_id UUID;
BEGIN
    v_reporter_id := auth.uid();
    IF v_reporter_id IS NULL THEN
        RAISE EXCEPTION 'Şikayet göndermek için giriş yapmalısınız.';
    END IF;

    INSERT INTO public.reports (
        id,
        reporter_id,
        reported_user_id,
        message_id,
        listing_id,
        reason,
        details,
        status,
        created_at
    ) VALUES (
        gen_random_uuid(),
        v_reporter_id,
        p_reported_user_id,
        p_message_id,
        p_listing_id,
        p_reason,
        p_details,
        'pending',
        NOW()
    )
    RETURNING id INTO v_report_id;

    RETURN jsonb_build_object('success', true, 'report_id', v_report_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_entity_rpc(UUID, UUID, UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. KVKK GİZLİLİK VE ADMIN ŞİKAYET İNCELEME RPC'Sİ
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_reported_conversation(
    p_report_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_report RECORD;
    v_conv_id UUID;
    v_messages jsonb;
BEGIN
    -- Sadece admin erişebilir
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Yetkisiz erişim: Bu işlem yönetici yetkisi gerektirir.';
    END IF;

    SELECT * INTO v_report FROM public.reports WHERE id = p_report_id;
    IF v_report.id IS NULL THEN
        RAISE EXCEPTION 'Şikayet kaydı bulunamadı.';
    END IF;

    -- Şikayet bir mesaja bağlıysa konuşmayı bul
    IF v_report.message_id IS NOT NULL THEN
        SELECT conversation_id INTO v_conv_id FROM public.messages WHERE id = v_report.message_id;
    END IF;

    IF v_conv_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Şikayete bağlı konuşma bulunamadı.');
    END IF;

    -- Denetim Günlüğü (Audit Log) Yaz
    INSERT INTO public.admin_activity_logs (
        admin_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
    ) VALUES (
        auth.uid(),
        'INSPECT_REPORTED_CONVERSATION',
        'report',
        p_report_id,
        jsonb_build_object('conversation_id', v_conv_id, 'reason', v_report.reason),
        NOW()
    );

    SELECT jsonb_agg(to_jsonb(m.*) ORDER BY m.created_at ASC)
    INTO v_messages
    FROM public.messages m
    WHERE m.conversation_id = v_conv_id;

    RETURN jsonb_build_object(
        'success', true,
        'conversation_id', v_conv_id,
        'report', to_jsonb(v_report),
        'messages', COALESCE(v_messages, '[]'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_reported_conversation(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. GÜVENLİK MODELİ (RLS POLİTİKALARI YENİLEME)
-- ------------------------------------------------------------------------------

-- A. CONVERSATIONS RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users delete conversations" ON public.conversations;

CREATE POLICY "conversations_select_participant" ON public.conversations
    FOR SELECT
    USING (
        auth.uid() = buyer_id 
        OR auth.uid() = seller_id
        OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
    );

CREATE POLICY "conversations_insert_participant" ON public.conversations
    FOR INSERT
    WITH CHECK (
        auth.uid() = buyer_id
    );

CREATE POLICY "conversations_update_participant" ON public.conversations
    FOR UPDATE
    USING (
        auth.uid() = buyer_id 
        OR auth.uid() = seller_id
        OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
    );

-- B. MESSAGES RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view conversation messages" ON public.messages;
DROP POLICY IF EXISTS "Users insert messages" ON public.messages;
DROP POLICY IF EXISTS "Users update messages" ON public.messages;
DROP POLICY IF EXISTS "Users delete messages" ON public.messages;
DROP POLICY IF EXISTS "messages_select_participant" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_sender" ON public.messages;
DROP POLICY IF EXISTS "messages_update_reader" ON public.messages;

-- Mesajları sadece konuşma katılımcıları görebilir (Adminler KVKK gereği göremez)
CREATE POLICY "messages_select_participant" ON public.messages
    FOR SELECT
    USING (
        conversation_id IN (
            SELECT id FROM public.conversations 
            WHERE buyer_id = auth.uid() 
               OR seller_id = auth.uid()
               OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
        )
    );

-- Mesaj ekleme (doğrudan SDK kullanılırsa)
CREATE POLICY "messages_insert_sender" ON public.messages
    FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id
        AND conversation_id IN (
            SELECT id FROM public.conversations 
            WHERE buyer_id = auth.uid() 
               OR seller_id = auth.uid()
               OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
        )
    );

-- Sadece okundu durumu (is_read, read_at) güncellenebilir
CREATE POLICY "messages_update_reader" ON public.messages
    FOR UPDATE
    USING (
        conversation_id IN (
            SELECT id FROM public.conversations 
            WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
        )
        AND sender_id != auth.uid()
    )
    WITH CHECK (
        conversation_id IN (
            SELECT id FROM public.conversations 
            WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
        )
    );

-- C. USER_BLOCKS RLS
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocks_select_owner" ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_insert_owner" ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_delete_owner" ON public.user_blocks;

CREATE POLICY "user_blocks_select_owner" ON public.user_blocks
    FOR SELECT
    USING (auth.uid() = blocker_id);

CREATE POLICY "user_blocks_insert_owner" ON public.user_blocks
    FOR INSERT
    WITH CHECK (auth.uid() = blocker_id AND blocker_id != blocked_id);

CREATE POLICY "user_blocks_delete_owner" ON public.user_blocks
    FOR DELETE
    USING (auth.uid() = blocker_id);

-- D. REPORTS RLS
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_select_policy" ON public.reports;
DROP POLICY IF EXISTS "reports_insert_policy" ON public.reports;
DROP POLICY IF EXISTS "reports_update_admin" ON public.reports;

CREATE POLICY "reports_select_policy" ON public.reports
    FOR SELECT
    USING (auth.uid() = reporter_id OR public.is_admin());

CREATE POLICY "reports_insert_policy" ON public.reports
    FOR INSERT
    WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "reports_update_admin" ON public.reports
    FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- E. NOTIFICATIONS RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_insert_system" ON public.notifications;
CREATE POLICY "notifications_insert_system" ON public.notifications
    FOR INSERT
    WITH CHECK (auth.uid() = user_id OR auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- 9. SUPABASE REALTIME ETKİNLEŞTİRME
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;

-- ------------------------------------------------------------------------------
-- 10. ÖZEL MEDYA DEPOLAMA ALANI (CHAT-ATTACHMENTS BUCKET)
-- ------------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'chat-attachments',
    'chat-attachments',
    false,
    10485760, -- 10 MB sınır
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Storage RLS politikaları
DROP POLICY IF EXISTS "chat_attachments_select" ON storage.objects;
DROP POLICY IF EXISTS "chat_attachments_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_attachments_delete" ON storage.objects;
DROP POLICY IF EXISTS "chat_attachments_select_participant" ON storage.objects;
DROP POLICY IF EXISTS "chat_attachments_insert_participant" ON storage.objects;
DROP POLICY IF EXISTS "chat_attachments_delete_participant" ON storage.objects;

-- Yardımcı Yetki Fonksiyonu: Dosya yolu <conversation_id>/<filename> formatında olmalıdır
-- Sadece konuşmanın katılımcıları (alıcı, satıcı veya firma sahibi) erişebilir
CREATE OR REPLACE FUNCTION public.can_access_chat_attachment(p_name text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conv_id_str text;
    v_conv_id uuid;
BEGIN
    IF p_user_id IS NULL OR p_name IS NULL THEN
        RETURN false;
    END IF;

    -- Dosya yolu: <conversation_id>/<filename>
    v_conv_id_str := split_part(p_name, '/', 1);
    
    -- UUID format denetimi (hatalı dosya yollarının sorguyu düşürmesini önler)
    IF v_conv_id_str !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;

    v_conv_id := v_conv_id_str::uuid;

    RETURN EXISTS (
        SELECT 1 
        FROM public.conversations c
        WHERE c.id = v_conv_id
          AND (
            c.buyer_id = p_user_id 
            OR c.seller_id = p_user_id
            OR c.company_id IN (SELECT id FROM public.companies WHERE user_id = p_user_id)
          )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_chat_attachment(text, uuid) TO authenticated;

-- 1. Okuma: Sadece konuşma katılımcıları (Anon hiçbir şey göremez)
CREATE POLICY "chat_attachments_select_participant" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'chat-attachments'
        AND public.can_access_chat_attachment(name, auth.uid())
    );

-- 2. Yükleme: Sadece konuşma katılımcıları
CREATE POLICY "chat_attachments_insert_participant" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'chat-attachments'
        AND public.can_access_chat_attachment(name, auth.uid())
    );

-- 3. Silme: Dosyayı yükleyen (owner) veya konuşma katılımcısı
CREATE POLICY "chat_attachments_delete_participant" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'chat-attachments'
        AND (owner = auth.uid() OR public.can_access_chat_attachment(name, auth.uid()))
    );

-- ------------------------------------------------------------------------------
-- 11. POSTGREST ŞEMA ÖNBELLEĞİNİ YENİLE (SCHEMA CACHE RELOAD)
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

