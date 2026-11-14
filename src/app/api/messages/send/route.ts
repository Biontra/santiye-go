import { NextRequest, NextResponse } from 'next/server';
import { serverSendMessage } from '@/lib/services/server-message-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { conversationId, senderId, body: messageBody, attachmentUrl } = body;

    if (!conversationId || !senderId) {
      return NextResponse.json(
        { success: false, error: 'conversationId ve senderId zorunludur' },
        { status: 400 }
      );
    }

    if (!messageBody && !attachmentUrl) {
      return NextResponse.json(
        { success: false, error: 'Mesaj içeriği boş olamaz' },
        { status: 400 }
      );
    }

    const result = await serverSendMessage({
      conversationId,
      senderId,
      body: messageBody || '',
      attachmentUrl,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API messages/send] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
