import { NextRequest, NextResponse } from 'next/server';
import { serverMarkAsRead } from '@/lib/services/server-message-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { conversationId } = body;

    if (!conversationId) {
      return NextResponse.json(
        { success: false, error: 'conversationId zorunludur' },
        { status: 400 }
      );
    }

    const success = await serverMarkAsRead(conversationId);
    return NextResponse.json({ success });
  } catch (err: any) {
    console.error('[API messages/read] error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Okundu bilgisi güncellenemedi.' },
      { status: 400 }
    );
  }
}
