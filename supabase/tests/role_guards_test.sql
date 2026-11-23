-- ROL VE FİRMA ONAYI KORUMALARI TESTİ (migration 31)
-- Boş bir yerel Postgres'te çalışır; Supabase'in auth şemasını ve rollerini taklit eder.
-- Çalıştırma: psql -v ON_ERROR_STOP=1 -d <bos_veritabani> -f supabase/tests/role_guards_test.sql
-- Not: 31 numaralı migration bu dosyadan ÖNCE değil, içindeki \i satırıyla yüklenir.

\set ON_ERROR_STOP 1
SET client_min_messages = warning;

-- --- Supabase taklidi ---
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin LOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

CREATE TYPE public.user_role AS ENUM ('buyer', 'company', 'admin', 'super_admin');
CREATE TYPE public.verification_status AS ENUM ('unverified', 'pending', 'approved', 'rejected');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role public.user_role NOT NULL DEFAULT 'buyer', full_name text);
CREATE TABLE public.admin_users (id uuid PRIMARY KEY, is_active boolean DEFAULT true);
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text,
  is_verified boolean DEFAULT false, verification_status public.verification_status DEFAULT 'unverified',
  verified_at timestamptz, verified_by uuid);

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid() AND is_active = true)
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'));
$$;

-- Kayıt tetikleyicisinin yaptığı işi taklit eden SECURITY DEFINER fonksiyon (rolü metadata'dan alır)
CREATE OR REPLACE FUNCTION public.fake_signup(p_id uuid, p_role text) RETURNS void LANGUAGE sql SECURITY DEFINER AS
  $$ INSERT INTO public.profiles (id, role) VALUES (p_id, p_role::public.user_role) $$;

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role, supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon, service_role, supabase_auth_admin;

\if :{?skip_migration}
\else
\i supabase/migrations/31_role_and_verification_guards.sql
\endif

CREATE OR REPLACE FUNCTION public.t_assert(p_ok boolean, p_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'BASARISIZ: %', p_name; END IF;
  RAISE WARNING 'GECTI: %', p_name;
END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO PUBLIC;

-- 1) Kayıt akışı (Supabase Auth oturumu) admin rolüyle profil açamaz
SET SESSION AUTHORIZATION supabase_auth_admin;
SELECT public.fake_signup('00000000-0000-0000-0000-000000000001', 'super_admin');
SELECT public.fake_signup('00000000-0000-0000-0000-000000000002', 'company');
RESET SESSION AUTHORIZATION;
SELECT public.t_assert((SELECT role = 'buyer' FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  'kayitta super_admin istegi buyer olur');
SELECT public.t_assert((SELECT role = 'company' FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000002'),
  'kayitta company rolu korunur');

-- 2) Kullanıcı tarayıcıdan kendi rolünü yükseltemez
SET test.uid = '00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
UPDATE public.profiles SET role = 'super_admin', full_name = 'Ali' WHERE id = '00000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.t_assert((SELECT role = 'buyer' AND full_name = 'Ali' FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  'kullanici rolunu yukseltemez ama diger alanlari guncelleyebilir');

-- 3) service_role (setup-admin betiği) yönetici atayabilir
SET ROLE service_role;
INSERT INTO public.profiles (id, role) VALUES ('00000000-0000-0000-0000-0000000000aa', 'super_admin')
  ON CONFLICT (id) DO UPDATE SET role = 'super_admin';
RESET ROLE;
SELECT public.t_assert((SELECT role = 'super_admin' FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000aa'),
  'service_role yonetici atayabilir');

-- 4) Firma kendini onaylı yapamaz, ama belgelerini gönderip 'pending' yapabilir
SET test.uid = '00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
INSERT INTO public.companies (id, user_id, name, is_verified, verification_status)
  VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000002', 'Firma', true, 'approved');
RESET ROLE;
SELECT public.t_assert((SELECT is_verified = false AND verification_status = 'unverified' FROM public.companies WHERE id = '00000000-0000-0000-0000-0000000000c1'),
  'firma onayli olarak eklenemez');

SET ROLE authenticated;
UPDATE public.companies SET is_verified = true, verification_status = 'approved', name = 'Yeni Ad' WHERE id = '00000000-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT public.t_assert((SELECT is_verified = false AND verification_status = 'unverified' AND name = 'Yeni Ad' FROM public.companies WHERE id = '00000000-0000-0000-0000-0000000000c1'),
  'firma kendini onaylayamaz ama adini degistirebilir');

SET ROLE authenticated;
UPDATE public.companies SET verification_status = 'pending' WHERE id = '00000000-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT public.t_assert((SELECT verification_status = 'pending' FROM public.companies WHERE id = '00000000-0000-0000-0000-0000000000c1'),
  'firma durumu pending yapabilir');

-- 5) Oturumu açık gerçek yönetici firmayı onaylayabilir
SET test.uid = '00000000-0000-0000-0000-0000000000aa';
SET ROLE authenticated;
UPDATE public.companies SET is_verified = true, verification_status = 'approved' WHERE id = '00000000-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT public.t_assert((SELECT is_verified AND verification_status = 'approved' FROM public.companies WHERE id = '00000000-0000-0000-0000-0000000000c1'),
  'yonetici firmayi onaylayabilir');

-- 6) Onaylı firma, durumu 'pending' yapıp sonra oynayamaz; onay bilgisi korunur
SET test.uid = '00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
UPDATE public.companies SET is_verified = false, verification_status = 'pending' WHERE id = '00000000-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT public.t_assert((SELECT is_verified AND verification_status = 'approved' FROM public.companies WHERE id = '00000000-0000-0000-0000-0000000000c1'),
  'onayli firmanin onay alanlari tarayicidan degismez');

SELECT 'TUM TESTLER GECTI' AS sonuc;
