import { NextResponse } from 'next/server';
import { confirmDeliveryAndReleaseEscrow } from '@/lib/services/delivery-service';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tokenOrPin, deliveryNote, actorUserId } = body;

    if (!tokenOrPin) {
      return NextResponse.json(
        { success: false, error: 'tokenOrPin parametresi zorunludur.' },
        { status: 400 }
      );
    }

    const res = await confirmDeliveryAndReleaseEscrow({
      tokenOrPin: String(tokenOrPin).trim(),
      actorUserId: actorUserId || 'buyer-demo-001',
      deliveryNote: deliveryNote ? String(deliveryNote).trim() : undefined,
      quantityConfirmed: true,
    });

    if (!res.success) {
      return NextResponse.json(res, { status: 400 });
    }

    return NextResponse.json(res);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Bilinmeyen bir sunucu hatası oluştu.' },
      { status: 500 }
    );
  }
}
