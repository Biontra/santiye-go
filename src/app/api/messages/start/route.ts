import { NextRequest, NextResponse } from 'next/server';
import { serverStartConversation } from '@/lib/services/server-message-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      buyerId,
      companyId,
      listingId,
      quoteId,
      companyName,
      buyerName,
      listingTitle,
      initialMessage,
    } = body;

    if (!buyerId || !companyId) {
      return NextResponse.json(
        { success: false, error: 'buyerId ve companyId zorunludur' },
        { status: 400 }
      );
    }

    const result = await serverStartConversation({
      buyerId,
      companyId,
      listingId,
      quoteId,
      companyName,
      buyerName,
      listingTitle,
      initialMessage,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API messages/start] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
