import { createClient } from '@/lib/supabase/server';
import { sanitizeRedirectUrl } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, any> | null;
};

/**
 * E-posta doğrulaması sonrası profil/firma kaydını tamamlar.
 *
 * Güvenlik: user_metadata kullanıcı tarafından düzenlenebilir. Bu yüzden metadata'dan
 * yalnızca 'buyer' | 'company' kabul edilir (admin/super_admin asla), ve var olan bir
 * profilin rolü bu akışta ezilmez (ör. yöneticinin rolü sıfırlanmaz).
 */
async function completeProfileAfterVerification(supabase: ServerClient, user: AuthUser) {
  const meta = (user.user_metadata || {}) as Record<string, any>;
  const metaRole: 'buyer' | 'company' = meta.role === 'company' ? 'company' : 'buyer';
  const nowIso = new Date().toISOString();

  const { data: existing } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  let effectiveRole: string = metaRole;

  if (existing) {
    effectiveRole = existing.role;
    const patch: Record<string, any> = { is_email_verified: true, email_verified_at: nowIso };
    if (existing.role === 'buyer' && metaRole === 'company') {
      patch.role = 'company';
      effectiveRole = 'company';
    }
    await supabase.from('profiles').update(patch).eq('id', user.id);
  } else {
    await supabase.from('profiles').insert({
      id: user.id,
      role: metaRole,
      full_name: meta.full_name || user.email?.split('@')[0] || 'Kullanıcı',
      phone: meta.phone || null,
      is_email_verified: true,
      email_verified_at: nowIso,
    });
  }

  if (effectiveRole === 'company') {
    const { data: comp } = await supabase
      .from('companies')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!comp) {
      await supabase.from('companies').insert({
        user_id: user.id,
        name: meta.company_name || meta.full_name || 'Firma Hesabı',
        tax_number: meta.tax_number || null,
        tax_office: meta.tax_office || null,
        phone: meta.phone || '',
        city_id: meta.city_id ? Number(meta.city_id) : null,
        district_id: meta.district_id ? Number(meta.district_id) : null,
        is_verified: false,
        is_demo: false,
      });
    }
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  // Açık yönlendirme (open redirect) koruması: yalnızca site içi göreli yollar.
  const next = sanitizeRedirectUrl(searchParams.get('next'), '/giris?verified=1');

  const supabase = await createClient();

  // 1. PKCE Code Exchange
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        await completeProfileAfterVerification(supabase, user);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 2. Token Hash Verify (OTP / Email link)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as any,
    });

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        await completeProfileAfterVerification(supabase, user);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/giris?verified=1`);
}
