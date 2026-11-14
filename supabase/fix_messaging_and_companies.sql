-- ==============================================================================
-- ŞANTİYE GO – MESAJLAŞMA VE FİRMA İLİŞKİLERİ KALICI ONARIM SQL'İ
-- Bu betiği Supabase Dashboard > SQL Editor alanına yapıştırıp "Run" butonuna basınız.
-- ==============================================================================

-- 1. EKSİK FİRMALARI PROFİLLERDEN OTOMATİK OLUŞTUR
INSERT INTO public.companies (
    id,
    user_id,
    name,
    phone,
    city_id,
    district_id,
    is_verified,
    is_demo
)
SELECT 
    p.id,
    p.id,
    COALESCE(p.full_name, 'Şantiye GO Onaylı Tedarikçi'),
    COALESCE(p.phone, '+905320000000'),
    34,
    104,
    true,
    false
FROM public.profiles p
LEFT JOIN public.companies c ON c.user_id = p.id
WHERE p.role = 'company' AND c.id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- 2. ÇİMENTO İLANINDAKİ ASILI KALAN FİRMAYI GÜVENLE BAĞLA VEYA OLUŞTUR
DO $$
DECLARE
    v_first_company_user UUID;
    v_existing_comp_id UUID;
BEGIN
    SELECT id INTO v_first_company_user 
    FROM public.profiles 
    WHERE role = 'company' 
    LIMIT 1;

    IF v_first_company_user IS NOT NULL THEN
        SELECT id INTO v_existing_comp_id FROM public.companies WHERE user_id = v_first_company_user;

        IF v_existing_comp_id IS NOT NULL THEN
            UPDATE public.listings 
            SET company_id = v_existing_comp_id 
            WHERE company_id = '262b3974-767a-478f-9bc5-f83ad643caea' 
               OR company_id NOT IN (SELECT id FROM public.companies);
        ELSE
            INSERT INTO public.companies (
                id,
                user_id,
                name,
                phone,
                city_id,
                district_id,
                is_verified,
                is_demo
            )
            VALUES (
                '262b3974-767a-478f-9bc5-f83ad643caea',
                v_first_company_user,
                'Şantiye GO Çimento & Yapı Malzemeleri',
                '+905320000000',
                34,
                101,
                true,
                false
            )
            ON CONFLICT (id) DO NOTHING;
        END IF;
    END IF;
END $$;

-- 3. CONVERSATIONS VE MESSAGES TABLOLARININ RLS POLİTİKALARINI SAĞLAMLAŞTIR
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Eski kısıtlayıcı politikaları kaldır
DROP POLICY IF EXISTS "Users view own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users update conversations" ON public.conversations;

DROP POLICY IF EXISTS "Users view conversation messages" ON public.messages;
DROP POLICY IF EXISTS "Users insert messages" ON public.messages;
DROP POLICY IF EXISTS "Users update messages" ON public.messages;

-- A. CONVERSATIONS İÇİN POLİTİKALAR:
CREATE POLICY "Users view own conversations" ON public.conversations
FOR SELECT USING (
    auth.uid() = buyer_id 
    OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
    OR company_id = auth.uid()
);

CREATE POLICY "Users insert conversations" ON public.conversations
FOR INSERT WITH CHECK (
    auth.uid() = buyer_id 
    OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
    OR company_id = auth.uid()
    OR auth.role() = 'authenticated'
);

CREATE POLICY "Users update conversations" ON public.conversations
FOR UPDATE USING (
    auth.uid() = buyer_id 
    OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
    OR company_id = auth.uid()
);

-- B. MESSAGES İÇİN POLİTİKALAR:
CREATE POLICY "Users view conversation messages" ON public.messages
FOR SELECT USING (
    conversation_id IN (
        SELECT id FROM public.conversations 
        WHERE buyer_id = auth.uid() 
           OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
           OR company_id = auth.uid()
    )
    OR sender_id = auth.uid()
);

CREATE POLICY "Users insert messages" ON public.messages
FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    OR auth.role() = 'authenticated'
);

CREATE POLICY "Users update messages" ON public.messages
FOR UPDATE USING (
    auth.uid() = sender_id
    OR conversation_id IN (
        SELECT id FROM public.conversations 
        WHERE buyer_id = auth.uid() 
           OR company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid())
    )
);

-- 4. REALTIME YAYININI GÜVENLE ETKİNLEŞTİR
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
