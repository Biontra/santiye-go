import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getContractById } from '@/lib/services/contract-service';
import { generateContractPdf } from '@/lib/services/pdf-service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const allowDemo =
      process.env.NEXT_PUBLIC_SHOW_DEMO_DATA === 'true' && process.env.NODE_ENV !== 'production';

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let snapshot: any = null;

    if (user && UUID_RE.test(id)) {
      // Oturum çerezindeki kullanıcı adına okunur: RLS sözleşme taraflarına izin verir.
      // Ek olarak yetki burada da açıkça doğrulanır (savunma derinliği).
      const { data: contract } = await supabase
        .from('contracts')
        .select('id, buyer_id, company_id, data_snapshot')
        .eq('id', id)
        .maybeSingle();

      if (contract) {
        const [{ data: profile }, { data: company }] = await Promise.all([
          supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
          supabase.from('companies').select('id').eq('user_id', user.id).maybeSingle(),
        ]);
        const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
        const isBuyer = contract.buyer_id === user.id;
        const isCompany = Boolean(company?.id) && contract.company_id === company!.id;

        if (isAdmin || isBuyer || isCompany) {
          snapshot = contract.data_snapshot;
        }
      }
    }

    // Yerel demo verisi yalnızca geliştirme/önizleme ortamında ve demo bayrağı açıkken sunulur.
    if (!snapshot && allowDemo) {
      const demo = await getContractById(id, 'system-api-caller', 'admin');
      if (demo.success && demo.contract) snapshot = demo.contract.data_snapshot;
    }

    if (!snapshot) {
      // Oturum yoksa 401, aksi halde varlığı sızdırmamak için 404.
      return NextResponse.json(
        { error: user ? 'Sözleşme bulunamadı veya erişim yetkiniz yok.' : 'Oturum açmanız gerekiyor.' },
        { status: user ? 404 : 401 }
      );
    }

    const { pdfBuffer, fileName } = await generateContractPdf(snapshot);
    const safeName = String(fileName || 'sozlesme.pdf').replace(/[^\w.\-]/g, '_');

    return new Response(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[api/contracts/pdf] error:', error);
    return NextResponse.json({ error: 'PDF üretilemedi.' }, { status: 500 });
  }
}
