-- ==============================================================================
-- ŞANTİYE GO – MESAJLAŞMA SİSTEMİ KAPSAMLI ENTEGRASYON VE GÜVENLİK TESTİ
-- Supabase Dashboard > SQL Editor alanında tek seferde çalıştırılabilir.
-- Bir TRANSACTION içinde çalışır ve sonda ROLLBACK yapar; veritabanında çöp satır bırakmaz.
-- Sonuçları tek bir PASS / FAIL tablosu olarak döner.
-- ==============================================================================

BEGIN;

-- Sonuç tablosu
CREATE TEMP TABLE test_results (
    test_num INT,
    test_name TEXT,
    status TEXT,
    details TEXT
) ON COMMIT DROP;

DO $$
DECLARE
    -- Test kullanıcıları (auth.users ve profiles için sanal UUID'ler)
    v_buyer_id UUID := '11111111-1111-4111-8111-111111111111'::uuid;
    v_seller_id UUID := '22222222-2222-4222-8222-222222222222'::uuid;
    v_third_party_id UUID := '33333333-3333-4333-8333-333333333333'::uuid;
    v_admin_id UUID := '44444444-4444-4444-8444-444444444444'::uuid;
    
    v_company_id UUID := '55555555-5555-4555-8555-555555555555'::uuid;
    v_listing_id UUID := '66666666-6666-4666-8666-666666666666'::uuid;
    
    v_conv_id1 UUID;
    v_conv_id2 UUID;
    v_msg_id UUID;
    v_cnt INT;
    v_res jsonb;
    v_msg_content TEXT;
BEGIN
    -- --------------------------------------------------------------------------
    -- 0. TEST FIXTURES (Geçici profiller, firma ve ilan oluştur)
    -- --------------------------------------------------------------------------
    INSERT INTO public.profiles (id, role, full_name, is_email_verified)
    VALUES 
        (v_buyer_id, 'buyer', 'Test Alıcı', true),
        (v_seller_id, 'company', 'Test Firma Sahibi', true),
        (v_third_party_id, 'buyer', 'Üçüncü Şahıs', true),
        (v_admin_id, 'admin', 'Test Yönetici', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.admin_users (id, role, is_active)
    VALUES (v_admin_id, 'admin', true)
    ON CONFLICT (id) DO UPDATE SET is_active = true;

    INSERT INTO public.companies (id, user_id, name, city_id, district_id, is_verified, is_demo)
    VALUES (v_company_id, v_seller_id, 'Test Makine A.Ş.', 34, 101, true, false)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listings (id, company_id, title, listing_type, status, is_demo)
    VALUES (v_listing_id, v_company_id, 'Test Ekskavatör İlanı', 'rental', 'active', false)
    ON CONFLICT (id) DO NOTHING;

    -- ==========================================================================
    -- TEST 1: Anon Kullanıcı Hiçbir Şey Okuyamaz
    -- ==========================================================================
    PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
    PERFORM set_config('role', 'anon', true);

    SELECT COUNT(*) INTO v_cnt FROM public.conversations;
    IF v_cnt = 0 THEN
        INSERT INTO test_results VALUES (1, 'Anon Rolü Konuşma Okuma Kısıtı', 'PASS', 'Anon rolü 0 konuşma gördü.');
    ELSE
        INSERT INTO test_results VALUES (1, 'Anon Rolü Konuşma Okuma Kısıtı', 'FAIL', 'Anon konuşma okuyabildi! Sayı: ' || v_cnt);
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.messages;
    IF v_cnt = 0 THEN
        INSERT INTO test_results VALUES (1, 'Anon Rolü Mesaj Okuma Kısıtı', 'PASS', 'Anon rolü 0 mesaj gördü.');
    ELSE
        INSERT INTO test_results VALUES (1, 'Anon Rolü Mesaj Okuma Kısıtı', 'FAIL', 'Anon mesaj okuyabildi! Sayı: ' || v_cnt);
    END IF;

    -- ==========================================================================
    -- TEST 5: Firma Sahibi Kendi İlanına Konuşma Başlatamaz
    -- ==========================================================================
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_seller_id::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    BEGIN
        v_res := public.get_or_create_conversation(
            p_listing_id := v_listing_id
        );
        INSERT INTO test_results VALUES (5, 'Kendi İlanına Mesaj Engeli', 'FAIL', 'Firma kendi ilanına konuşma başlatabildi!');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO test_results VALUES (5, 'Kendi İlanına Mesaj Engeli', 'PASS', 'Beklendiği gibi engellendi: ' || SQLERRM);
    END;

    -- ==========================================================================
    -- TEST 6: Bul veya Oluştur Çift Konuşma Üretmez (Tekil Konuşma Garantisi)
    -- ==========================================================================
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_buyer_id::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    v_res := public.get_or_create_conversation(
        p_listing_id := v_listing_id,
        p_initial_message := 'Merhaba ilanınız hakkında bilgi alabilir miyim?'
    );
    v_conv_id1 := (v_res->>'conversation_id')::uuid;

    -- İkinci kez aynı parametrelerle çağır
    v_res := public.get_or_create_conversation(
        p_listing_id := v_listing_id
    );
    v_conv_id2 := (v_res->>'conversation_id')::uuid;

    IF v_conv_id1 IS NOT NULL AND v_conv_id1 = v_conv_id2 THEN
        INSERT INTO test_results VALUES (6, 'Atomik Bul veya Oluştur (Idempotency)', 'PASS', 'Aynı konuşma kimliği döndü: ' || v_conv_id1);
    ELSE
        INSERT INTO test_results VALUES (6, 'Atomik Bul veya Oluştur (Idempotency)', 'FAIL', 'Mükerrer konuşma oluştu! ID1: ' || v_conv_id1 || ' ID2: ' || v_conv_id2);
    END IF;

    -- ==========================================================================
    -- TEST 2: Üçüncü Kullanıcı Başkasının Konuşma ve Mesajını Okuyamaz
    -- ==========================================================================
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_third_party_id::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT COUNT(*) INTO v_cnt FROM public.conversations WHERE id = v_conv_id1;
    IF v_cnt = 0 THEN
        INSERT INTO test_results VALUES (2, 'Üçüncü Şahıs Konuşma İzolasyonu (RLS)', 'PASS', 'Üçüncü taraf konuşmayı göremedi.');
    ELSE
        INSERT INTO test_results VALUES (2, 'Üçüncü Şahıs Konuşma İzolasyonu (RLS)', 'FAIL', 'Üçüncü taraf konuşmayı okuyabildi!');
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.messages WHERE conversation_id = v_conv_id1;
    IF v_cnt = 0 THEN
        INSERT INTO test_results VALUES (2, 'Üçüncü Şahıs Mesaj İzolasyonu (RLS)', 'PASS', 'Üçüncü taraf mesajları göremedi.');
    ELSE
        INSERT INTO test_results VALUES (2, 'Üçüncü Şahıs Mesaj İzolasyonu (RLS)', 'FAIL', 'Üçüncü taraf mesajları okuyabildi!');
    END IF;

    -- ==========================================================================
    -- TEST 3: Başka Kullanıcı Adına Mesaj Eklenemez (Kimlik Sahteciliği Engeli)
    -- ==========================================================================
    BEGIN
        INSERT INTO public.messages (conversation_id, sender_id, content)
        VALUES (v_conv_id1, v_buyer_id, 'Ben alıcıyım ama başkası yazdı.');
        INSERT INTO test_results VALUES (3, 'Başkasının Adına Mesaj Gönderme Engeli', 'FAIL', 'Başka kullanıcı adına mesaj eklenebildi!');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO test_results VALUES (3, 'Başkasının Adına Mesaj Gönderme Engeli', 'PASS', 'RLS sahte kimliği engelledi: ' || SQLERRM);
    END;

    -- ==========================================================================
    -- TEST 4: Katılımcı Olmayan Konuşmaya Mesaj Yazılamaz
    -- ==========================================================================
    BEGIN
        v_res := public.send_message_rpc(
            p_conversation_id := v_conv_id1,
            p_content := 'Yetkisiz araya girme denemesi.'
        );
        INSERT INTO test_results VALUES (4, 'Yetkisiz Konuşmaya Mesaj Yazma Engeli', 'FAIL', 'Katılımcı olmayan kullanıcı mesaj yazabildi!');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO test_results VALUES (4, 'Yetkisiz Konuşmaya Mesaj Yazma Engeli', 'PASS', 'RPC yetkisiz mesajı engelledi: ' || SQLERRM);
    END;

    -- ==========================================================================
    -- TEST 9: Maskeleme Telefon/E-posta/IBAN Bilgisini Ham Saklamaz (9A)
    -- ==========================================================================
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_buyer_id::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    v_res := public.send_message_rpc(
        p_conversation_id := v_conv_id1,
        p_content := 'Numaram 0532 123 45 67, mailim ornek@santiye.com ve IBAN TR12 0006 1005 1980 0000 0000 01 beni ara.'
    );

    v_msg_id := ((v_res->>'message')::jsonb->>'id')::uuid;
    SELECT content INTO v_msg_content FROM public.messages WHERE id = v_msg_id;

    IF v_msg_content NOT LIKE '%0532%' 
       AND v_msg_content NOT LIKE '%ornek@santiye.com%' 
       AND v_msg_content NOT LIKE '%TR12%' 
       AND v_msg_content LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (9, 'İletişim Maskeleme (9A) Ham Veri Koruması', 'PASS', 'Telefon, e-posta ve IBAN veritabanına sadece maskeli yazıldı.');
    ELSE
        INSERT INTO test_results VALUES (9, 'İletişim Maskeleme (9A) Ham Veri Koruması', 'FAIL', 'Ham iletişim bilgisi veritabanına sızdı: ' || v_msg_content);
    END IF;

    -- ==========================================================================
    -- TEST 7: Okunmamış Sayaç ve Okundu İşaretleme Doğruluğu
    -- ==========================================================================
    -- Alıcı firma sahibine mesaj attı, firma sahibi gelen kutusunu okusun
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_seller_id::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT COUNT(*) INTO v_cnt 
    FROM public.messages 
    WHERE conversation_id = v_conv_id1 AND sender_id != v_seller_id AND is_read = false;

    IF v_cnt > 0 THEN
        v_res := public.mark_messages_read(v_conv_id1);
        
        SELECT COUNT(*) INTO v_cnt 
        FROM public.messages 
        WHERE conversation_id = v_conv_id1 AND sender_id != v_seller_id AND is_read = false;

        IF v_cnt = 0 THEN
            INSERT INTO test_results VALUES (7, 'Okunmamış Sayaç ve Okundu İşaretleme', 'PASS', 'Mesajlar başarıyla okundu olarak güncellendi.');
        ELSE
            INSERT INTO test_results VALUES (7, 'Okunmamış Sayaç ve Okundu İşaretleme', 'FAIL', 'Okundu işaretleme sonrası okunmamış mesaj kaldı!');
        END IF;
    ELSE
        INSERT INTO test_results VALUES (7, 'Okunmamış Sayaç ve Okundu İşaretleme', 'FAIL', 'Başlangıçta okunmamış mesaj bulunamadı.');
    END IF;

    -- ==========================================================================
    -- TEST 8: Engellenen Kullanıcı Mesaj Gönderemez
    -- ==========================================================================
    -- Firma alıcıyı engellesin
    v_res := public.block_user_rpc(v_buyer_id);

    -- Alıcı mesaj göndermeyi denesin
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_buyer_id::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    BEGIN
        v_res := public.send_message_rpc(
            p_conversation_id := v_conv_id1,
            p_content := 'Engeli aşmaya çalışan mesaj.'
        );
        INSERT INTO test_results VALUES (8, 'Engellenen Kullanıcı Mesaj Kısıtı', 'FAIL', 'Engelli kullanıcı mesaj gönderebildi!');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO test_results VALUES (8, 'Engellenen Kullanıcı Mesaj Kısıtı', 'PASS', 'Engelleme kuralı işletildi: ' || SQLERRM);
    END;

    -- ==========================================================================
    -- TEST 10: Admin Normal Konuşmayı Göremez (KVKK Gizliliği)
    -- ==========================================================================
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT COUNT(*) INTO v_cnt FROM public.messages WHERE conversation_id = v_conv_id1;
    IF v_cnt = 0 THEN
        INSERT INTO test_results VALUES (10, 'Admin KVKK Mesaj Gizliliği', 'PASS', 'Admin şikayetsiz genel mesajları doğrudan okuyamadı.');
    ELSE
        INSERT INTO test_results VALUES (10, 'Admin KVKK Mesaj Gizliliği', 'FAIL', 'Admin RLS atlatarak normal mesajları okuyabildi! Sayı: ' || v_cnt);
    END IF;

    -- ==========================================================================
    -- TEST 11: SQL Seviyesi Maskeleme Birim Testleri (mask_contact_info)
    -- ==========================================================================
    -- 11.1 Telefon (0532 formatı)
    v_res := public.mask_contact_info('Numaram 05321234567 arayabilirsiniz.');
    IF (v_res->>'is_masked')::boolean = true AND (v_res->>'sanitized_text') LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (11, 'SQL Mask: Telefon (0532 bitişik)', 'PASS', 'Başarıyla maskelendi: ' || (v_res->>'sanitized_text'));
    ELSE
        INSERT INTO test_results VALUES (11, 'SQL Mask: Telefon (0532 bitişik)', 'FAIL', 'Maskelenemedi: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 11.2 Telefon (Standart boşluklu 05xx)
    v_res := public.mask_contact_info('İletişim için: 0532 123 45 67');
    IF (v_res->>'is_masked')::boolean = true AND (v_res->>'sanitized_text') LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (11, 'SQL Mask: Telefon (Boşluklu 05xx)', 'PASS', 'Başarıyla maskelendi.');
    ELSE
        INSERT INTO test_results VALUES (11, 'SQL Mask: Telefon (Boşluklu 05xx)', 'FAIL', 'Maskelenemedi: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 11.3 Telefon (+90 formatı)
    v_res := public.mask_contact_info('Telefonum: +90 532 123 45 67 hemen görüşelim.');
    IF (v_res->>'is_masked')::boolean = true AND (v_res->>'sanitized_text') LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (11, 'SQL Mask: Telefon (+90 formatı)', 'PASS', 'Başarıyla maskelendi.');
    ELSE
        INSERT INTO test_results VALUES (11, 'SQL Mask: Telefon (+90 formatı)', 'FAIL', 'Maskelenemedi: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 11.4 Telefon (Ayrık/tek tek yazılmış rakamlar)
    v_res := public.mask_contact_info('Bana 0 5 3 2 1 2 3 4 5 6 7 numarasından yazın');
    IF (v_res->>'is_masked')::boolean = true AND (v_res->>'sanitized_text') LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (11, 'SQL Mask: Telefon (Ayrık tek tek rakamlar)', 'PASS', 'Başarıyla maskelendi.');
    ELSE
        INSERT INTO test_results VALUES (11, 'SQL Mask: Telefon (Ayrık tek tek rakamlar)', 'FAIL', 'Maskelenemedi: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 11.5 E-Posta
    v_res := public.mask_contact_info('Mail adresim ornek@santiye.com dur');
    IF (v_res->>'is_masked')::boolean = true AND (v_res->>'sanitized_text') LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (11, 'SQL Mask: E-Posta', 'PASS', 'Başarıyla maskelendi.');
    ELSE
        INSERT INTO test_results VALUES (11, 'SQL Mask: E-Posta', 'FAIL', 'Maskelenemedi: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 11.6 IBAN
    v_res := public.mask_contact_info('Hesap: TR33 0006 1005 1234 5678 9012 34');
    IF (v_res->>'is_masked')::boolean = true AND (v_res->>'sanitized_text') LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (11, 'SQL Mask: IBAN', 'PASS', 'Başarıyla maskelendi.');
    ELSE
        INSERT INTO test_results VALUES (11, 'SQL Mask: IBAN', 'FAIL', 'Maskelenemedi: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 11.7 Yasaklı Kelime / Harici Yönlendirme (whatsapp / elden anlaşalım)
    v_res := public.mask_contact_info('Whatsapp üzerinden konuşalım komisyonsuz elden anlaşalım');
    IF (v_res->>'is_masked')::boolean = true AND (v_res->>'sanitized_text') LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (11, 'SQL Mask: Yasaklı Kelimeler (Whatsapp/Elden)', 'PASS', 'Başarıyla maskelendi.');
    ELSE
        INSERT INTO test_results VALUES (11, 'SQL Mask: Yasaklı Kelimeler (Whatsapp/Elden)', 'FAIL', 'Maskelenemedi: ' || (v_res->>'sanitized_text'));
    END IF;

    -- ==========================================================================
    -- TEST 12: SQL Seviyesi Yanlış Alarm Güvenlik Testleri (False Positive Safe)
    -- ==========================================================================
    -- 12.1 Fiyat
    v_res := public.mask_contact_info('Günlük kiralama bedeli 15.000 ₺ olarak belirlendi.');
    IF (v_res->>'is_masked')::boolean = false AND (v_res->>'sanitized_text') NOT LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Fiyat (15.000 ₺)', 'PASS', 'Fiyat doğru şekilde korunarak maskelenmedi.');
    ELSE
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Fiyat (15.000 ₺)', 'FAIL', 'Hatalı maskeleme yapıldı: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 12.2 Tonaj
    v_res := public.mask_contact_info('Ekskavatör çalışma ağırlığı 22 ton dur.');
    IF (v_res->>'is_masked')::boolean = false AND (v_res->>'sanitized_text') NOT LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Tonaj (22 ton)', 'PASS', 'Tonaj korunarak maskelenmedi.');
    ELSE
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Tonaj (22 ton)', 'FAIL', 'Hatalı maskeleme yapıldı: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 12.3 Model Kodu
    v_res := public.mask_contact_info('Makinemiz CAT 320D ve JCB JS220 serisidir.');
    IF (v_res->>'is_masked')::boolean = false AND (v_res->>'sanitized_text') NOT LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Model (CAT 320D)', 'PASS', 'Model kodu korunarak maskelenmedi.');
    ELSE
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Model (CAT 320D)', 'FAIL', 'Hatalı maskeleme yapıldı: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 12.4 Alan m2
    v_res := public.mask_contact_info('Şantiye alanı 120 m2 genişliğindedir.');
    IF (v_res->>'is_masked')::boolean = false AND (v_res->>'sanitized_text') NOT LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Alan (120 m2)', 'PASS', 'Alan ölçüsü korunarak maskelenmedi.');
    ELSE
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Alan (120 m2)', 'FAIL', 'Hatalı maskeleme yapıldı: ' || (v_res->>'sanitized_text'));
    END IF;

    -- 12.5 Tarih
    v_res := public.mask_contact_info('Teslimat planlanan tarihi 2026-11-05 günüdür.');
    IF (v_res->>'is_masked')::boolean = false AND (v_res->>'sanitized_text') NOT LIKE '%[iletişim bilgisi gizlendi]%' THEN
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Tarih (2026-11-05)', 'PASS', 'Tarih korunarak maskelenmedi.');
    ELSE
        INSERT INTO test_results VALUES (12, 'SQL Yanlış Alarm Koruması: Tarih (2026-11-05)', 'FAIL', 'Hatalı maskeleme yapıldı: ' || (v_res->>'sanitized_text'));
    END IF;

    -- ==========================================================================
    -- TEST 13: chat-attachments Storage İzolasyonu (can_access_chat_attachment)
    -- ==========================================================================
    -- Alıcı kendi konuşmasının dosyasına erişebilir
    IF public.can_access_chat_attachment(v_conv_id1::text || '/fotograf.jpg', v_buyer_id) = true THEN
        INSERT INTO test_results VALUES (13, 'Storage Katılımcı Okuma İzni (Alıcı)', 'PASS', 'Alıcı kendi konuşmasının eki için yetkilendirildi.');
    ELSE
        INSERT INTO test_results VALUES (13, 'Storage Katılımcı Okuma İzni (Alıcı)', 'FAIL', 'Alıcı kendi dosyasına erişemedi!');
    END IF;

    -- Satıcı kendi konuşmasının dosyasına erişebilir
    IF public.can_access_chat_attachment(v_conv_id1::text || '/fotograf.jpg', v_seller_id) = true THEN
        INSERT INTO test_results VALUES (13, 'Storage Katılımcı Okuma İzni (Firma)', 'PASS', 'Firma sahibi konuşma eki için yetkilendirildi.');
    ELSE
        INSERT INTO test_results VALUES (13, 'Storage Katılımcı Okuma İzni (Firma)', 'FAIL', 'Firma sahibi dosyaya erişemedi!');
    END IF;

    -- Üçüncü şahıs dosyaya ASLA erişemez
    IF public.can_access_chat_attachment(v_conv_id1::text || '/fotograf.jpg', v_third_party_id) = false THEN
        INSERT INTO test_results VALUES (13, 'Storage Üçüncü Şahıs İzolasyonu', 'PASS', 'Üçüncü tarafın dosya erişimi engellendi.');
    ELSE
        INSERT INTO test_results VALUES (13, 'Storage Üçüncü Şahıs İzolasyonu', 'FAIL', 'Üçüncü şahıs başkasının konuşma ekine erişebildi!');
    END IF;

    -- Anon / NULL kullanıcı hiçbir şeye erişemez
    IF public.can_access_chat_attachment(v_conv_id1::text || '/fotograf.jpg', NULL) = false THEN
        INSERT INTO test_results VALUES (13, 'Storage Anon İzolasyonu', 'PASS', 'Anon (NULL kullanıcı) dosya erişimi engellendi.');
    ELSE
        INSERT INTO test_results VALUES (13, 'Storage Anon İzolasyonu', 'FAIL', 'Anon kullanıcı dosya ekine erişebildi!');
    END IF;

END $$;

-- Tüm test sonuçlarını tek sonuç kümesi olarak listele
SELECT 
    test_num AS "#",
    test_name AS "Test Adı",
    status AS "Durum",
    details AS "Açıklama"
FROM test_results
ORDER BY test_num;

-- Veritabanına hiçbir test verisi yazılmaması için işlemi geri al
ROLLBACK;
