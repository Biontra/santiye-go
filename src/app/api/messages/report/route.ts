import { NextRequest, NextResponse } from 'next/server';
import { serverReportEntity } from '@/lib/services/server-message-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reportedUserId, messageId, listingId, reason, details } = body;

    if (!reason) {
      return NextResponse.json(
        { success: false, error: 'Şikayet nedeni zorunludur' },
        { status: 400 }
      );
    }

    const result = await serverReportEntity({
      reportedUserId,
      messageId,
      listingId,
      reason,
      details,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API messages/report] error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Şikayet iletilemedi.' },
      { status: 400 }
    );
  }
}
