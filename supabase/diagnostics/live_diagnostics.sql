-- ============================================================
-- ŞANTİYE GO – CANLI TEŞHİS SORGULARI
-- Supabase SQL Editor'de çalıştırın (psql komutu yok).
-- Kişisel veri (telefon, e-posta, vergi no, IBAN) DÖNMEMEKTEDİR.
-- ============================================================

-- ============================================================
-- BÖLÜM 1: Tablo Satır Sayıları
-- ============================================================
SELECT 'ROW_COUNTS' AS section, table_name, (
  SELECT reltuples::bigint FROM pg_class
  WHERE relname = t.table_name AND relnamespace = 'public'::regnamespace
) AS estimated_row_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'profiles','companies','listings','conversations','messages',
    'favorites','company_subscriptions','membership_plans',
    'categories','cities','districts','quote_requests','bookings',
    'admin_users'
  )
ORDER BY table_name;

-- ============================================================
-- BÖLÜM 2: RLS Durumu (tüm public tablolar)
-- ============================================================
SELECT 'RLS_STATUS' AS section,
       relname AS table_name,
       relrowsecurity AS rls_enabled,
       relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
ORDER BY relname;

-- ============================================================
-- BÖLÜM 3: Tüm RLS Politikaları (USING + WITH CHECK)
-- ============================================================
SELECT 'RLS_POLICIES' AS section,
       schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual       AS using_expr,
       with_check AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles','companies','listings','conversations','messages',
    'favorites','company_subscriptions','membership_plans',
    'quote_requests','bookings'
  )
ORDER BY tablename, policyname;

-- ============================================================
-- BÖLÜM 4: anon ve authenticated rollerinin companies kolonlarındaki hakları
-- ============================================================
SELECT 'COMPANIES_COLUMN_PRIVS' AS section,
       grantee,
       column_name,
       privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'companies'
  AND grantee IN ('anon','authenticated')
ORDER BY grantee, column_name;

-- ============================================================
-- BÖLÜM 5: listings üzerindeki Trigger'lar
-- ============================================================
SELECT 'LISTING_TRIGGERS' AS section,
       trigger_name,
       event_manipulation,
       action_timing,
       action_statement,
       action_orientation
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'listings'
ORDER BY trigger_name;

-- ============================================================
-- BÖLÜM 6: listings Yabancı Anahtarları ve ON DELETE Kuralları
-- ============================================================
SELECT 'LISTING_FK_DELETE_RULES' AS section,
       tc.constraint_name,
       kcu.column_name,
       ccu.table_name  AS referenced_table,
       ccu.column_name AS referenced_column,
       rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
     ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints rc
     ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
     ON rc.unique_constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name = 'listings'
ORDER BY kcu.column_name;

-- ============================================================
-- BÖLÜM 7: profiles.role dağılımı ve companies eşleşmesi
-- ============================================================
SELECT 'PROFILES_ROLE_COMPANY_MATCH' AS section,
       p.role,
       COUNT(p.id)                                       AS profile_count,
       COUNT(c.id)                                       AS company_count,
       COUNT(p.id) - COUNT(c.id)                        AS profiles_without_company
FROM public.profiles p
LEFT JOIN public.companies c ON c.user_id = p.id
GROUP BY p.role
ORDER BY p.role;

-- ============================================================
-- BÖLÜM 8: membership_plans içeriği
-- ============================================================
SELECT 'MEMBERSHIP_PLANS' AS section,
       *
FROM public.membership_plans
ORDER BY id;

-- ============================================================
-- BÖLÜM 9: Firma başına abonelik durumu (kişisel veri maskelendi)
-- ============================================================
SELECT 'COMPANY_SUBSCRIPTIONS' AS section,
       cs.company_id,
       c.name        AS company_name,
       cs.plan_id,
       cs.status,
       cs.current_period_start,
       cs.current_period_end
FROM public.company_subscriptions cs
JOIN public.companies c ON c.id = cs.company_id
ORDER BY cs.created_at DESC;

-- ============================================================
-- BÖLÜM 10: Firmalar – doğrulama durumu (hassas kolonlar hariç)
-- ============================================================
SELECT 'COMPANIES_VERIFICATION' AS section,
       id,
       name,
       is_verified,
       verification_status,
       onboarding_step,
       city_id,
       district_id,
       (location IS NOT NULL) AS has_location,
       (tax_number IS NOT NULL AND length(tax_number) > 0) AS has_tax_number,
       is_demo,
       created_at
FROM public.companies
ORDER BY created_at DESC;

-- ============================================================
-- BÖLÜM 11: listings – aktif ve durum dağılımı (kişisel veri yok)
-- ============================================================
SELECT 'LISTINGS_STATUS' AS section,
       status,
       COUNT(*) AS count,
       MAX(created_at) AS latest_created
FROM public.listings
GROUP BY status
ORDER BY count DESC;

-- ============================================================
-- BÖLÜM 12: Aktif ilanların tam listesi (ilan fotoğrafı var mı?)
-- ============================================================
SELECT 'ACTIVE_LISTINGS_DETAIL' AS section,
       l.id,
       l.title,
       l.status,
       l.district_id,
       d.name AS district_name,
       l.city_id,
       c2.name AS city_name,
       (l.location IS NOT NULL) AS has_location,
       (l.images IS NOT NULL AND array_length(l.images, 1) > 0) AS has_images,
       l.images[1]              AS first_image_url,
       l.is_demo,
       co.name                  AS company_name,
       co.is_verified           AS company_verified,
       co.verification_status   AS company_verification_status,
       l.created_at
FROM public.listings l
LEFT JOIN public.companies co ON co.id = l.company_id
LEFT JOIN public.districts d  ON d.id  = l.district_id
LEFT JOIN public.cities c2    ON c2.id = l.city_id
WHERE l.status = 'active'
ORDER BY l.created_at DESC;

-- ============================================================
-- BÖLÜM 13: search_listings_advanced RPC var mı ve tanımı
-- ============================================================
SELECT 'RPC_SEARCH_LISTINGS' AS section,
       routine_name,
       routine_type,
       data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('search_listings_advanced','count_listings_by_radii');

-- ============================================================
-- BÖLÜM 14: search_listings_advanced – distance_km kolon kaynağı
--            (ambiguous column tespiti için)
-- ============================================================
SELECT 'RPC_DISTANCE_KM_CHECK' AS section,
       prosrc
FROM pg_proc
WHERE proname = 'search_listings_advanced'
  AND pronamespace = 'public'::regnamespace;

-- ============================================================
-- BÖLÜM 15: favorites / conversations / messages satır kontrolü
-- ============================================================
SELECT 'MESSAGING_FAVORITES_COUNTS' AS section,
       (SELECT COUNT(*) FROM public.favorites)      AS favorites_count,
       (SELECT COUNT(*) FROM public.conversations)  AS conversations_count,
       (SELECT COUNT(*) FROM public.messages)       AS messages_count;

-- ============================================================
-- BÖLÜM 16: companies hassas kolonların şema kontrolü
--            (iban, accept_online_payments default değeri)
-- ============================================================
SELECT 'COMPANIES_SENSITIVE_COLUMNS' AS section,
       column_name,
       data_type,
       column_default,
       is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'companies'
  AND column_name IN (
    'iban','accept_online_payments','tax_number',
    'sub_merchant_key','notification_preferences',
    'credit_balance','verification_notes'
  )
ORDER BY column_name;

-- ============================================================
-- BÖLÜM 17: listings.status enum değerleri
-- ============================================================
SELECT 'LISTING_STATUS_ENUM' AS section,
       t.typname AS enum_name,
       e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname ILIKE '%listing%status%'
   OR t.typname ILIKE '%listing_status%'
ORDER BY t.typname, e.enumsortorder;
