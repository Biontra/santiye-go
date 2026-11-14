import { NextRequest, NextResponse } from 'next/server';
import { serverBlockUser } from '@/lib/services/server-message-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { conversationId, blockerId } = body;

    if (!conversationId) {
      return NextResponse.json(
        { success: false, error: 'conversationId zorunludur' },
        { status: 400 }
      );
    }

    const success = await serverBlockUser(conversationId, blockerId || '');
    return NextResponse.json({ success });
  } catch (err: any) {
    console.error('[API messages/block] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
