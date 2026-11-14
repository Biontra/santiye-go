import { NextRequest, NextResponse } from 'next/server';
import { serverGetMessages } from '@/lib/services/server-message-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return NextResponse.json({ success: false, error: 'conversationId gereklidir' }, { status: 400 });
    }

    const messages = await serverGetMessages(conversationId);
    return NextResponse.json({ success: true, messages });
  } catch (err: any) {
    console.error('[API messages/list] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
