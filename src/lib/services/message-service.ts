import { Conversation, Message } from '@/types/database';
import { MaskDetectedType } from '@/lib/security/contact-masker';

export interface DemoConversation extends Conversation {
  seller_id?: string;
  other_user_name: string;
  other_user_role: string;
  other_user_id?: string;
  listing_title?: string;
  unread_count: number;
  last_message?: string;
  last_message_at?: string;
  company_name?: string;
  buyer_name?: string;
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 1. KONUŞMALARI GETİR
 * Canlı sunucu API'si üzerinden oturum açmış kullanıcının konuşmalarını çeker.
 */
export async function getConversations(userId?: string): Promise<DemoConversation[]> {
  try {
    const queryParam = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    const res = await fetch(`/api/messages/conversations${queryParam}`, {
      cache: 'no-store',
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Konuşmalar getirilemedi.');
    }

    const json = await res.json();
    if (json.success && Array.isArray(json.conversations)) {
      return json.conversations;
    }
    return [];
  } catch (err: any) {
    console.error('[getConversations] Hata:', err.message);
    throw err;
  }
}

/**
 * 2. MESAJLARI GETİR
 * Seçili konuşmanın mesajlarını çeker.
 */
export async function getMessages(conversationId: string): Promise<Message[]> {
  if (!conversationId) return [];

  try {
    const res = await fetch(`/api/messages/list?conversationId=${encodeURIComponent(conversationId)}`, {
      cache: 'no-store',
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Mesajlar yüklenemedi.');
    }

    const json = await res.json();
    if (json.success && Array.isArray(json.messages)) {
      return json.messages;
    }
    return [];
  } catch (err: any) {
    console.error('[getMessages] Hata:', err.message);
    throw err;
  }
}

/**
 * 3. MESAJ GÖNDER
 * Çift gönderim koruması (clientMessageId), sunucu maskelemesi ve hata geri bildirimi ile gönderir.
 */
export async function sendMessage(
  conversationId: string,
  _senderId: string, // Sunucu auth.uid() üzerinden güvenle doğrular
  body: string,
  attachmentUrl?: string | null
): Promise<{
  success: boolean;
  message?: Message;
  error?: string;
  isMasked?: boolean;
  detectedTypes?: MaskDetectedType[];
  infoNotice?: string;
}> {
  if (!body.trim() && !attachmentUrl) {
    return { success: false, error: 'Mesaj içeriği veya fotoğraf eki gereklidir.' };
  }

  const clientMessageId = generateUUID();

  try {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        body: body.trim(),
        attachmentUrl: attachmentUrl || null,
        clientMessageId,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json.success) {
      return {
        success: false,
        error: json.error || 'Mesaj gönderilemedi. Lütfen tekrar deneyiniz.',
      };
    }

    return {
      success: true,
      message: json.message,
      isMasked: json.isMasked,
      detectedTypes: json.detectedTypes,
      infoNotice: json.infoNotice,
    };
  } catch (err: any) {
    console.error('[sendMessage] Ağ hatası:', err.message);
    return {
      success: false,
      error: 'Ağ bağlantısı kurulamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyiniz.',
    };
  }
}

/**
 * 4. KONUŞMA BAŞLAT / BUL
 * Atomik RPC üzerinden konuşmayı bulur veya oluşturur.
 */
export async function startConversation({
  listingId,
  companyId,
  quoteRequestId,
  initialMessage,
}: {
  buyerId?: string;
  companyId?: string;
  listingId?: string;
  quoteId?: string;
  quoteRequestId?: string;
  companyName?: string;
  buyerName?: string;
  listingTitle?: string;
  initialMessage?: string;
}): Promise<{ success: boolean; conversationId?: string; error?: string }> {
  try {
    const res = await fetch('/api/messages/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId,
        companyId,
        quoteRequestId,
        initialMessage,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json.success) {
      return {
        success: false,
        error: json.error || 'Konuşma başlatılamadı.',
      };
    }

    return {
      success: true,
      conversationId: json.conversationId,
    };
  } catch (err: any) {
    console.error('[startConversation] Ağ hatası:', err.message);
    return {
      success: false,
      error: 'Sunucuyla bağlantı kurulamadı. Lütfen tekrar deneyiniz.',
    };
  }
}

/**
 * 5. OKUNDU İŞARETLE
 */
export async function markConversationAsRead(
  conversationId: string,
  _userId?: string
): Promise<void> {
  if (!conversationId) return;

  try {
    await fetch('/api/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    });
  } catch (err) {
    console.warn('[markConversationAsRead] Hata:', err);
  }
}

/**
 * 6. ŞİKAYET ET
 */
export async function reportMessage(
  messageId: string,
  _reporterId: string,
  reason: string,
  details?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/messages/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId,
        reason,
        details,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || 'Şikayet iletilemedi.' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Bağlantı hatası oluştu.' };
  }
}

/**
 * 7. KULLANICIYI ENGELLE
 */
export async function blockUser(
  blockedUserId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/messages/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockedUserId }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || 'Kullanıcı engellenemedi.' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Bağlantı hatası oluştu.' };
  }
}
