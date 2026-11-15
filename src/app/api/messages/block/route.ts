import { NextRequest, NextResponse } from 'next/server';
import { serverBlockUser } from '@/lib/services/server-message-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { blockedUserId } = body;

    if (!blockedUserId) {
      return NextResponse.json(
        { success: false, error: 'blockedUserId zorunludur' },
        { status: 400 }
      );
    }

    const success = await serverBlockUser(blockedUserId);
    return NextResponse.json({ success });
  } catch (err: any) {
    console.error('[API messages/block] error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Kullanıcı engellenemedi.' },
      { status: 400 }
    );
  }
}
