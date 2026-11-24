import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const ALLOWED_ACTIONS = ['approve', 'reject'] as const;

export async function POST(req: NextRequest) {
  try {
    // 1. Kimlik doğrulama
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 });
    }

    // 2. Yetki kontrolü (rol profiles tablosundan okunur, user_metadata'dan değil)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 });
    }

    // 3. Girdi doğrulama
    const body = await req.json().catch(() => null);
    const listingId = body?.listingId;
    const action = body?.action;

    if (!listingId || typeof listingId !== 'string' || !ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: 'Geçerli listingId ve action (approve | reject) zorunludur.' },
        { status: 400 }
      );
    }

    const newStatus = action === 'approve' ? 'active' : 'inactive';

    // 4. Güncelleme (yetki doğrulandıktan sonra service role ile)
    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from('listings')
      .update({ status: newStatus })
      .eq('id', listingId)
      .select('id, status')
      .maybeSingle();

    if (error) {
      console.error('[api/admin/listings/moderate] DB update error:', error.message);
      return NextResponse.json({ error: 'İlan durumu güncellenemedi.' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'İlan bulunamadı.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, status: data.status });
  } catch (err) {
    console.error('[api/admin/listings/moderate] error:', err);
    return NextResponse.json({ error: 'Moderasyon hatası' }, { status: 500 });
  }
}
