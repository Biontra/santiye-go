-- ==============================================================================
-- ŞANTİYE GO – MIGRATION 22: CANLI SİTE NİHAİ DÜZELTMELERİ
-- (Admin yetkileri, RLS güvenlik kilidi, PostGIS arama düzeltmesi,
--  moderasyon akışı, ücretsiz üyelik otomasyonu ve veri bütünlüğü)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. LISTING_STATUS ENUM GÜNCELLEMESİ (Moderasyon & Soft Delete)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'pending_approval';
    ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'rejected';
    ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'deleted';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE public.listings 
    ALTER COLUMN status SET DEFAULT 'pending_approval';

-- ------------------------------------------------------------------------------
-- 2. ADMIN YETKİLERİ VE IS_ADMIN() GÜÇLENDİRİLMESİ
-- ------------------------------------------------------------------------------
-- Profiles tablosundaki super_admin kullanıcılarını admin_users tablosuna senkronize et
INSERT INTO public.admin_users (id, role, is_active)
SELECT id, 'super_admin', true
FROM public.profiles
WHERE role = 'super_admin'
ON CONFLICT (id) DO UPDATE SET is_active = true, role = 'super_admin';

-- is_admin() fonksiyonu hem admin_users tablosuna hem de profiles.role değerine bakar
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = auth.uid() AND is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;

-- ------------------------------------------------------------------------------
-- 3. COMPANIES TABLOSU GÜVENLİK VE ALAN DÜZELTMELERİ (D1, F7, F8)
-- ------------------------------------------------------------------------------
-- IBAN kolonu kaldırılır (Tam IBAN saklama yasaklandı)
ALTER TABLE public.companies DROP COLUMN IF EXISTS iban;

-- accept_online_payments varsayılanı false yapılır
ALTER TABLE public.companies ALTER COLUMN accept_online_payments SET DEFAULT false;
UPDATE public.companies SET accept_online_payments = false WHERE accept_online_payments IS TRUE;

-- Companies RLS politikası: Hassas kolonlar sadece sahibi ve admin tarafından okunabilir
DROP POLICY IF EXISTS "Companies are viewable by everyone" ON public.companies;
DROP POLICY IF EXISTS "companies_owner_or_admin_select" ON public.companies;
DROP POLICY IF EXISTS "companies_public_select_safe" ON public.companies;

CREATE POLICY "companies_owner_or_admin_select" ON public.companies
    FOR SELECT
    USING (
        auth.uid() = user_id
        OR public.is_admin()
        OR auth.role() = 'service_role'
    );

-- Halka açık güvenli görünüm (public_companies)
-- Güvenlik Notu: security_invoker = false ve postgres sahibi ile çalışır.
-- Yalnızca güvenli alanlar (ad, logo, il, ilçe, doğrulandı mı) sunulur.
-- Telefon, vergi no, bakiye, evrak URL'leri ASLA dışarı sızamaz.
DROP VIEW IF EXISTS public.public_companies CASCADE;

CREATE OR REPLACE VIEW public.public_companies
WITH (security_invoker = false)
AS
SELECT 
    c.id,
    c.user_id,
    c.name,
    c.logo_url,
    c.city_id,
    c.district_id,
    c.is_verified,
    c.verification_status,
    c.created_at
FROM public.companies c;

GRANT SELECT ON public.public_companies TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. POSTGIS GELİŞMİŞ ARAMA RPC AMBIGUOUS DISTANCE_KM DÜZELTMESİ (D4, F4)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_listings_advanced(
    p_user_lat DOUBLE PRECISION,
    p_user_lng DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 25.0,
    p_category_id UUID DEFAULT NULL,
    p_subcategory_slug TEXT DEFAULT NULL,
    p_keyword TEXT DEFAULT NULL,
    p_city_id INT DEFAULT NULL,
    p_district_id INT DEFAULT NULL,
    p_neighborhood_id INT DEFAULT NULL,
    p_postal_code VARCHAR DEFAULT NULL,
    p_min_price NUMERIC DEFAULT NULL,
    p_max_price NUMERIC DEFAULT NULL,
    p_listing_type listing_type DEFAULT NULL,
    p_operator_included BOOLEAN DEFAULT NULL,
    p_fuel_included BOOLEAN DEFAULT NULL,
    p_transport_included BOOLEAN DEFAULT NULL,
    p_status listing_status DEFAULT 'active',
    p_sort_by TEXT DEFAULT 'distance', -- 'distance', 'price_asc', 'newest'
    p_limit INT DEFAULT 20,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    company_id UUID,
    company_name VARCHAR,
    company_logo TEXT,
    company_phone VARCHAR,
    company_whatsapp VARCHAR,
    category_id UUID,
    category_name VARCHAR,
    category_slug VARCHAR,
    title VARCHAR,
    slug VARCHAR,
    description TEXT,
    listing_type listing_type,
    price_daily NUMERIC,
    price_weekly NUMERIC,
    price_monthly NUMERIC,
    price_sale NUMERIC,
    currency VARCHAR,
    is_operator_included BOOLEAN,
    is_fuel_included BOOLEAN,
    is_transport_included BOOLEAN,
    status listing_status,
    city_name VARCHAR,
    district_name VARCHAR,
    neighborhood_name VARCHAR,
    postal_code VARCHAR,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    technical_specs JSONB,
    images TEXT[],
    distance_km DOUBLE PRECISION,
    is_demo BOOLEAN,
    created_at TIMESTAMPTZ,
    total_count BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_geo GEOGRAPHY;
BEGIN
    IF p_user_lat IS NOT NULL AND p_user_lng IS NOT NULL THEN
        user_geo := ST_SetSRID(ST_MakePoint(p_user_lng, p_user_lat), 4326)::geography;
    END IF;

    RETURN QUERY
    WITH filtered AS (
        SELECT 
            l.id,
            l.company_id,
            c.name AS company_name,
            c.logo_url AS company_logo,
            ''::VARCHAR AS company_phone,      -- Telefon doğrudan açılmaz (Prompt 9A İletişim Koruması)
            ''::VARCHAR AS company_whatsapp,   -- WhatsApp doğrudan açılmaz
            l.category_id,
            cat.name AS category_name,
            cat.slug AS category_slug,
            l.title,
            l.slug,
            l.description,
            l.listing_type,
            l.price_daily,
            l.price_weekly,
            l.price_monthly,
            l.price_sale,
            l.currency,
            l.is_operator_included,
            l.is_fuel_included,
            l.is_transport_included,
            l.status,
            ci.name AS city_name,
            di.name AS district_name,
            ''::VARCHAR AS neighborhood_name,
            ''::VARCHAR AS postal_code,
            ST_Y(l.location::geometry) AS lat,
            ST_X(l.location::geometry) AS lng,
            l.technical_specs,
            l.images,
            CASE 
                WHEN user_geo IS NOT NULL THEN 
                    ROUND((ST_Distance(l.location, user_geo) / 1000.0)::numeric, 1)::DOUBLE PRECISION
                ELSE NULL 
            END AS distance_km_val,
            l.is_demo,
            l.created_at,
            COUNT(*) OVER() AS total_count
        FROM public.listings l
        JOIN public.companies c ON l.company_id = c.id
        LEFT JOIN public.categories cat ON l.category_id = cat.id
        LEFT JOIN public.cities ci ON l.city_id = ci.id
        LEFT JOIN public.districts di ON l.district_id = di.id
        WHERE (p_status IS NULL OR l.status = p_status)
          AND (l.status != 'deleted')
          -- PostGIS mesafe filtresi
          AND (
            p_radius_km IS NULL 
            OR p_radius_km <= 0 
            OR user_geo IS NULL 
            OR ST_DWithin(l.location, user_geo, p_radius_km * 1000.0)
          )
          -- Kategori filtresi
          AND (
            p_category_id IS NULL 
            OR l.category_id = p_category_id 
            OR cat.parent_id = p_category_id
          )
          AND (
            p_subcategory_slug IS NULL 
            OR cat.slug = p_subcategory_slug
          )
          -- İl / İlçe Filtresi
          AND (p_city_id IS NULL OR l.city_id = p_city_id)
          AND (p_district_id IS NULL OR l.district_id = p_district_id)
          -- Metin Araması
          AND (
            p_keyword IS NULL 
            OR l.title ILIKE '%' || p_keyword || '%' 
            OR l.description ILIKE '%' || p_keyword || '%'
            OR c.name ILIKE '%' || p_keyword || '%'
          )
          -- İlan Türü (Kiralık / Satılık)
          AND (p_listing_type IS NULL OR l.listing_type = p_listing_type)
          -- Fiyat Aralığı
          AND (
            p_min_price IS NULL 
            OR COALESCE(l.price_daily, l.price_sale, 0) >= p_min_price
          )
          AND (
            p_max_price IS NULL 
            OR COALESCE(l.price_daily, l.price_sale, 99999999) <= p_max_price
          )
          -- Dahil Olan Hizmetler
          AND (p_operator_included IS NULL OR l.is_operator_included = p_operator_included)
          AND (p_fuel_included IS NULL OR l.is_fuel_included = p_fuel_included)
          AND (p_transport_included IS NULL OR l.is_transport_included = p_transport_included)
    )
    SELECT 
        f.id,
        f.company_id,
        f.company_name,
        f.company_logo,
        f.company_phone,
        f.company_whatsapp,
        f.category_id,
        f.category_name,
        f.category_slug,
        f.title,
        f.slug,
        f.description,
        f.listing_type,
        f.price_daily,
        f.price_weekly,
        f.price_monthly,
        f.price_sale,
        f.currency,
        f.is_operator_included,
        f.is_fuel_included,
        f.is_transport_included,
        f.status,
        f.city_name,
        f.district_name,
        f.neighborhood_name,
        f.postal_code,
        f.lat,
        f.lng,
        f.technical_specs,
        f.images,
        f.distance_km_val AS distance_km,
        f.is_demo,
        f.created_at,
        f.total_count
    FROM filtered f
    ORDER BY
        CASE WHEN p_sort_by = 'distance' AND user_geo IS NOT NULL THEN f.distance_km_val END ASC,
        CASE WHEN p_sort_by = 'price_asc' THEN COALESCE(f.price_daily, f.price_sale) END ASC,
        CASE WHEN p_sort_by = 'newest' THEN f.created_at END DESC,
        f.id DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_listings_advanced TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. GÜVENLİ VE HIZLI TEKİL İLAN GETİRME RPC (get_public_listing_by_id_or_slug)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_listing_by_id_or_slug(p_id_or_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'id', l.id,
        'company_id', l.company_id,
        'category_id', l.category_id,
        'title', l.title,
        'slug', l.slug,
        'description', l.description,
        'listing_type', l.listing_type,
        'price_daily', l.price_daily,
        'price_weekly', l.price_weekly,
        'price_monthly', l.price_monthly,
        'price_sale', l.price_sale,
        'currency', l.currency,
        'is_operator_included', l.is_operator_included,
        'is_fuel_included', l.is_fuel_included,
        'is_transport_included', l.is_transport_included,
        'status', l.status,
        'city_id', l.city_id,
        'district_id', l.district_id,
        'address_detail', l.address_detail,
        'lat', ST_Y(l.location::geometry),
        'lng', ST_X(l.location::geometry),
        'technical_specs', l.technical_specs,
        'images', l.images,
        'is_demo', l.is_demo,
        'created_at', l.created_at,
        'updated_at', l.updated_at,
        'city_name', ci.name,
        'district_name', di.name,
        'category_name', cat.name,
        'category_slug', cat.slug,
        'company_name', c.name,
        'company_logo', c.logo_url,
        'company_is_verified', c.is_verified,
        'company_verification_status', c.verification_status
    ) INTO v_result
    FROM public.listings l
    JOIN public.companies c ON l.company_id = c.id
    LEFT JOIN public.categories cat ON l.category_id = cat.id
    LEFT JOIN public.cities ci ON l.city_id = ci.id
    LEFT JOIN public.districts di ON l.district_id = di.id
    WHERE (l.id::text = p_id_or_slug OR l.slug = p_id_or_slug)
      AND (
          l.status = 'active'
          OR auth.uid() = c.user_id
          OR public.is_admin()
          OR auth.role() = 'service_role'
      );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_listing_by_id_or_slug(TEXT) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. ÜCRETSİZ ÜYELİK GERİ DOLDURMA VE GÜVENLİK (D5, F2)
-- ------------------------------------------------------------------------------
-- Abonelik satırı olmayan tüm mevcut firmalara 'free' başlangıç paketi ata
INSERT INTO public.company_subscriptions (
    company_id,
    plan_id,
    billing_cycle,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    is_demo
)
SELECT 
    c.id,
    'free',
    'monthly',
    'active',
    NOW(),
    NOW() + INTERVAL '10 years',
    false,
    false
FROM public.companies c
WHERE NOT EXISTS (
    SELECT 1 FROM public.company_subscriptions cs WHERE cs.company_id = c.id
);

-- Yeni kullanıcı tetikleyicisini temizleyip sağlamlaştır
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_raw_role TEXT;
    v_role public.user_role;
    v_full_name TEXT;
    v_phone TEXT;
    v_company_name TEXT;
    v_tax_number TEXT;
    v_tax_office TEXT;
    v_city_id INT;
    v_district_id INT;
    v_new_company_id UUID;
BEGIN
    v_raw_role := COALESCE(new.raw_user_meta_data->>'role', 'buyer');
    IF v_raw_role NOT IN ('buyer', 'company', 'admin', 'super_admin') THEN
        v_raw_role := 'buyer';
    END IF;
    v_role := v_raw_role::public.user_role;

    v_full_name := COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
    v_phone := new.raw_user_meta_data->>'phone';
    v_company_name := new.raw_user_meta_data->>'company_name';
    v_tax_number := new.raw_user_meta_data->>'tax_number';
    v_tax_office := new.raw_user_meta_data->>'tax_office';

    -- VKN sadece 10 hane ise al (11 hane TCKN kabul edilmez)
    IF v_tax_number IS NOT NULL AND LENGTH(REGEXP_REPLACE(v_tax_number, '\D', '', 'g')) = 10 THEN
        v_tax_number := REGEXP_REPLACE(v_tax_number, '\D', '', 'g');
    ELSE
        v_tax_number := NULL;
    END IF;

    BEGIN
        v_city_id := (new.raw_user_meta_data->>'city_id')::INT;
    EXCEPTION WHEN OTHERS THEN
        v_city_id := NULL;
    END;

    BEGIN
        v_district_id := (new.raw_user_meta_data->>'district_id')::INT;
    EXCEPTION WHEN OTHERS THEN
        v_district_id := NULL;
    END;

    -- Profiles tablosunu güncelle veya ekle
    INSERT INTO public.profiles (
        id,
        role,
        full_name,
        phone,
        kvkk_accepted_at,
        kvkk_version,
        is_email_verified,
        is_phone_verified
    ) VALUES (
        new.id,
        v_role,
        v_full_name,
        v_phone,
        NOW(),
        'v1.0',
        (new.email_confirmed_at IS NOT NULL),
        (new.phone_confirmed_at IS NOT NULL)
    )
    ON CONFLICT (id) DO UPDATE
    SET
        role = CASE 
            WHEN public.profiles.role IN ('admin', 'super_admin') THEN public.profiles.role 
            ELSE EXCLUDED.role 
        END,
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        phone = COALESCE(public.profiles.phone, EXCLUDED.phone),
        is_email_verified = CASE WHEN new.email_confirmed_at IS NOT NULL THEN true ELSE public.profiles.is_email_verified END;

    -- Eğer süper admin ise admin_users'a da ekle
    IF v_role = 'super_admin' THEN
        INSERT INTO public.admin_users (id, role, is_active)
        VALUES (new.id, 'super_admin', true)
        ON CONFLICT (id) DO UPDATE SET is_active = true, role = 'super_admin';
    END IF;

    -- SADECE rolü 'company' olan kullanıcılar için companies kaydı oluştur
    IF v_role = 'company' THEN
        INSERT INTO public.companies (
            user_id,
            name,
            tax_number,
            tax_office,
            phone,
            city_id,
            district_id,
            is_verified,
            is_demo,
            onboarding_step,
            accept_online_payments
        ) VALUES (
            new.id,
            COALESCE(v_company_name, v_full_name, 'Firma Hesabı'),
            v_tax_number,
            v_tax_office,
            COALESCE(v_phone, ''),
            v_city_id,
            v_district_id,
            false,
            false,
            'pending_documents',
            false
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            name = COALESCE(EXCLUDED.name, public.companies.name),
            tax_number = COALESCE(EXCLUDED.tax_number, public.companies.tax_number),
            tax_office = COALESCE(EXCLUDED.tax_office, public.companies.tax_office)
        RETURNING id INTO v_new_company_id;

        IF v_new_company_id IS NOT NULL THEN
            INSERT INTO public.company_subscriptions (
                company_id,
                plan_id,
                billing_cycle,
                status,
                current_period_start,
                current_period_end
            ) VALUES (
                v_new_company_id,
                'free',
                'monthly',
                'active',
                NOW(),
                NOW() + INTERVAL '10 years'
            )
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 7. LISTINGS RLS POLİTİKALARININ GÜNCELLENMESİ (Soft Delete & Admin Moderasyon)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Active listings viewable by everyone" ON public.listings;
DROP POLICY IF EXISTS "Company owners can delete their listings" ON public.listings;
DROP POLICY IF EXISTS "Company owners can update their listings" ON public.listings;
DROP POLICY IF EXISTS "Physical delete restricted to service role" ON public.listings;

-- Aktif ilanlar herkese açık, silinmiş ilanlar herkese kapalı; firma sahibi ve admin tümünü görebilir
CREATE POLICY "Active listings viewable by everyone" ON public.listings
    FOR SELECT
    USING (
        (status = 'active' AND status != 'deleted')
        OR (auth.uid() IN (SELECT companies.user_id FROM public.companies WHERE companies.id = listings.company_id))
        OR public.is_admin()
        OR auth.role() = 'service_role'
    );

-- Firma sahibi ilanını güncelleyebilir (soft delete için status = 'deleted')
CREATE POLICY "Company owners can update their listings" ON public.listings
    FOR UPDATE
    USING (
        auth.uid() IN (SELECT companies.user_id FROM public.companies WHERE companies.id = listings.company_id)
        OR public.is_admin()
        OR auth.role() = 'service_role'
    );

-- Fiziksel DELETE tamamen engellenir veya yalnızca service_role'a izin verilir
CREATE POLICY "Physical delete restricted to service role" ON public.listings
    FOR DELETE
    USING (
        auth.role() = 'service_role'
    );
