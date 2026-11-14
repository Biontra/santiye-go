-- ============================================================
-- ADIM 1: ENUM DEĞERLERİNİ EKLE (Tek başına çalıştırın)
-- PostgreSQL kuralı gereği enum değerleri eklendikten sonra 
-- commit edilmelidir. Bu sorguyu SQL Editor'de tek başına çalıştırın.
-- ============================================================
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'pending_approval';
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'deleted';
