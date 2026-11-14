import { NextRequest, NextResponse } from 'next/server';
import { serverGetConversations } from '@/lib/services/server-message-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId gereklidir' }, { status: 400 });
    }

    const conversations = await serverGetConversations(userId);
    return NextResponse.json({ success: true, conversations });
  } catch (err: any) {
    console.error('[API conversations] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
