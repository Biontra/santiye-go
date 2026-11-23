import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { isAdminRole } from '@/lib/security/admin-guard';

export async function POST(req: NextRequest) {
  try {
    // 1. Kimlik: oturum çerezinden gerçek kullanıcı
    const sessionClient = await createClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Giriş yapılmamış.' }, { status: 401 });
    }

    // 2. Yetki: rol veritabanındaki profilden okunur (user_metadata'ya güvenilmez)
    const serviceClient = createServiceRoleClient();
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!isAdminRole(profile?.role)) {
      return NextResponse.json({ error: 'Bu işlem yalnız yöneticiler içindir.' }, { status: 403 });
    }

    const body = await req.json();
    const { listingId, action } = body;

    if (!listingId || !action) {
      return NextResponse.json({ error: 'listingId ve action zorunludur' }, { status: 400 });
    }

    const newStatus = action === 'approve' ? 'active' : 'inactive';

    const { error } = await serviceClient
      .from('listings')
      .update({ status: newStatus })
      .eq('id', listingId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Moderasyon hatası' }, { status: 500 });
  }
}
