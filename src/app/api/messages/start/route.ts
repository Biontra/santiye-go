import { NextRequest, NextResponse } from 'next/server';
import { serverStartConversation } from '@/lib/services/server-message-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      listingId,
      companyId,
      quoteRequestId,
      initialMessage,
    } = body;

    if (!listingId && !companyId && !quoteRequestId) {
      return NextResponse.json(
        { success: false, error: 'Bir ilan, teklif talebi veya firma belirtilmelidir.' },
        { status: 400 }
      );
    }

    const result = await serverStartConversation({
      listingId,
      companyId,
      quoteRequestId,
      initialMessage,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API messages/start] error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Konuşma başlatılamadı.' },
      { status: 400 }
    );
  }
}
