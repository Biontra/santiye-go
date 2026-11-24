-- ==============================================================================
-- 31 – ROL VE FİRMA ONAYI KORUMALARI
-- Kapatılan açıklar:
--   1) Kayıt olurken gönderilen veriyle (user_metadata.role) admin/super_admin olunabiliyordu.
--   2) Kullanıcı kendi profil satırında role alanını değiştirebiliyordu.
--   3) Firma sahibi kendi firmasını is_verified / verification_status ile "onaylı" yapabiliyordu.
--   4) Firma sahibi kendi kredi bakiyesini (credit_balance) istediği sayıya çekebiliyordu.
--
-- Kural: bu alanları yalnız şunlar değiştirebilir
--   - service_role (sunucu, scripts/setup-admin.ts),
--   - SQL editörü / veritabanı sahibi,
--   - SECURITY DEFINER fonksiyonlar (current_user fonksiyon sahibidir),
--   - oturumu açık gerçek bir yönetici (public.is_admin()).
-- Tarayıcıdan gelen sıradan istekler (current_user = authenticated/anon) değiştiremez.
-- Tekrar çalıştırılabilir (idempotent).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.is_untrusted_client()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_user IN ('authenticated', 'anon') AND NOT COALESCE(public.is_admin(), false);
$$;

-- ---------- profiles.role ----------
CREATE OR REPLACE FUNCTION public.guard_profile_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Kayıt akışı (Supabase Auth, session_user = supabase_auth_admin) ve tarayıcı istekleri
    -- yönetici rolüyle profil AÇAMAZ; rol 'buyer' yapılır. Yönetici sonradan
    -- scripts/setup-admin.ts (service_role) ile atanır.
    IF NEW.role IN ('admin', 'super_admin')
       AND (session_user = 'supabase_auth_admin' OR public.is_untrusted_client()) THEN
      NEW.role := 'buyer';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       AND (session_user = 'supabase_auth_admin' OR public.is_untrusted_client()) THEN
      NEW.role := OLD.role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_role ON public.profiles;
CREATE TRIGGER trg_guard_profile_role
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role();

-- ---------- companies: onay alanları ----------
CREATE OR REPLACE FUNCTION public.guard_company_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.is_untrusted_client() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_verified := false;
    IF NEW.verification_status IS NOT NULL
       AND NEW.verification_status::text NOT IN ('unverified', 'pending') THEN
      NEW.verification_status := 'unverified';
    END IF;
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
  ELSE
    NEW.is_verified := OLD.is_verified;
    NEW.verified_at := OLD.verified_at;
    NEW.verified_by := OLD.verified_by;
    -- Firma yalnız belgelerini gönderip durumu 'pending' yapabilir; onayı yönetici verir.
    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
       AND NOT (NEW.verification_status::text = 'pending' AND OLD.verification_status::text IS DISTINCT FROM 'approved') THEN
      NEW.verification_status := OLD.verification_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_company_verification ON public.companies;
CREATE TRIGGER trg_guard_company_verification
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_verification();

-- ---------- companies: kredi bakiyesi ----------
-- Firma sahibi kendi satırını güncelleyebildiği için bakiyesini de istediği sayıya çekebiliyordu.
-- Tarayıcıdan gelen istek bakiyeyi ARTIRAMAZ; düşürebilir (teklif verirken kredi harcama bozulmasın diye).
-- Kredi yüklemeyi yalnız sunucu (service_role), SQL editörü ya da oturumu açık yönetici yapar.
-- credit_balance sütunu yoksa (12 numaralı migration çalışmamışsa) bu bölüm atlanır.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'credit_balance') THEN
    CREATE OR REPLACE FUNCTION public.guard_company_credit()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NOT public.is_untrusted_client() THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'INSERT' THEN
        NEW.credit_balance := 0;
      ELSIF COALESCE(NEW.credit_balance, 0) > COALESCE(OLD.credit_balance, 0) THEN
        NEW.credit_balance := OLD.credit_balance;
      END IF;
      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_guard_company_credit ON public.companies;
    CREATE TRIGGER trg_guard_company_credit
      BEFORE INSERT OR UPDATE ON public.companies
      FOR EACH ROW EXECUTE FUNCTION public.guard_company_credit();
  END IF;
END
$do$;

-- ---------- Denetim sorgusu (elle çalıştırın) ----------
-- Açık kapanmadan önce kendini yönetici yapmış hesap var mı diye bakın:
--   SELECT p.id, u.email, p.role, p.created_at
--   FROM public.profiles p JOIN auth.users u ON u.id = p.id
--   WHERE p.role IN ('admin', 'super_admin') ORDER BY p.created_at;
-- Bakiyesi şüpheli firmalar (defterdeki toplamla uyuşmayanlar):
--   SELECT c.id, c.name, c.credit_balance, COALESCE(SUM(l.amount), 0) AS defter_toplami
--   FROM public.companies c LEFT JOIN public.company_credit_ledgers l ON l.company_id = c.id
--   GROUP BY c.id HAVING c.credit_balance <> COALESCE(SUM(l.amount), 0);
