import { NextRequest, NextResponse } from 'next/server';
import { serverSendMessage } from '@/lib/services/server-message-store';
import { sendMessageNotificationEmail } from '@/lib/services/email-service';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { conversationId, body: messageBody, attachmentUrl, clientMessageId } = body;

    if (!conversationId) {
      return NextResponse.json(
        { success: false, error: 'conversationId zorunludur' },
        { status: 400 }
      );
    }

    if (!messageBody && !attachmentUrl) {
      return NextResponse.json(
        { success: false, error: 'Mesaj içeriği veya fotoğraf eki zorunludur' },
        { status: 400 }
      );
    }

    const result = await serverSendMessage({
      conversationId,
      body: messageBody || '',
      attachmentUrl,
      clientMessageId,
    });

    // Arka planda e-posta bildirim kontrolü (kısıtlanmış/throttled)
    // E-posta başarısız olsa bile mesajlaşma akışını asla bozmaz
    try {
      const supabase = await createClient();
      const { data: convData } = await supabase
        .from('conversations')
        .select('buyer_id, seller_id, company_id')
        .eq('id', conversationId)
        .maybeSingle();

      const { data: { user } } = await supabase.auth.getUser();
      if (convData && user) {
        const isBuyerSender = user.id === convData.buyer_id;
        const recipientUserId = isBuyerSender ? convData.seller_id : convData.buyer_id;

        // Alıcının e-posta adresini profiles / auth tablosundan çek
        if (recipientUserId) {
          const { data: recProfile } = await supabase
            .from('profiles')
            .select('id, full_name, is_email_verified')
            .eq('id', recipientUserId)
            .maybeSingle();

          const recipientName = recProfile?.full_name || 'Kullanıcımız';

          // Eğer auth'tan e-posta varsa gönder
          const { data: authUser } = await supabase.auth.admin.getUserById(recipientUserId).catch(() => ({ data: { user: null } }));
          const targetEmail = authUser?.user?.email;

          if (targetEmail && recProfile?.is_email_verified) {
            sendMessageNotificationEmail(targetEmail, recipientName)
              .then((res) => {
                if (!res.success) {
                  console.warn('[messages/send] E-posta bildirimi gönderilemedi:', res.error);
                } else {
                  console.log('[messages/send] E-posta bildirimi gönderildi. MessageId:', res.messageId);
                }
              })
              .catch((err) =>
                console.error('[messages/send] E-posta bildirim istisnası:', err?.message)
              );
          }
        }
      }
    } catch (emailErr) {
      console.warn('[messages/send] E-posta tetikleme atlandı:', emailErr);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API messages/send] error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Mesaj gönderilemedi.' },
      { status: 400 }
    );
  }
}
