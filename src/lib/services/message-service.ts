import { createClient } from '@/lib/supabase/client';
import { Conversation, Message } from '@/types/database';
import { sanitizeContent, MaskDetectedType } from '@/lib/security/contact-masker';

export interface DemoConversation extends Conversation {
  other_user_name: string;
  other_user_role: string;
  listing_title?: string;
  unread_count: number;
  last_message?: string;
  last_message_at?: string;
  company_name?: string;
  buyer_name?: string;
}

const STORAGE_CONVERSATIONS_KEY = 'santiyego_conversations_store';
const STORAGE_MESSAGES_KEY_PREFIX = 'santiyego_messages_store_';

export const DEMO_CONVERSATIONS: DemoConversation[] = [];
export const DEMO_MESSAGES: Record<string, Message[]> = {};

const memConversations: DemoConversation[] = [];
const memMessages: Record<string, Message[]> = {};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function getStoredConversations(): DemoConversation[] {
  if (typeof window === 'undefined') return [...memConversations];
  try {
    const raw = localStorage.getItem(STORAGE_CONVERSATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredConversations(convs: DemoConversation[]) {
  if (typeof window === 'undefined') {
    memConversations.length = 0;
    memConversations.push(...convs);
    return;
  }
  try {
    localStorage.setItem(STORAGE_CONVERSATIONS_KEY, JSON.stringify(convs));
  } catch {}
}

function getStoredMessages(convId: string): Message[] {
  if (typeof window === 'undefined') return [...(memMessages[convId] || [])];
  try {
    const raw = localStorage.getItem(STORAGE_MESSAGES_KEY_PREFIX + convId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredMessages(convId: string, msgs: Message[]) {
  if (typeof window === 'undefined') {
    memMessages[convId] = [...msgs];
    return;
  }
  try {
    localStorage.setItem(STORAGE_MESSAGES_KEY_PREFIX + convId, JSON.stringify(msgs));
  } catch {}
}

// 1. KONUŞMALARI GETİR (Merkezi API Öncelikli)
export async function getConversations(userId: string): Promise<DemoConversation[]> {
  if (!userId) return [];

  // A. Tarayıcıdaysa Merkezi API'den çek (Sunucu üzerinden iki tarafı eşleştirir)
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/messages/conversations?userId=${encodeURIComponent(userId)}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.conversations)) {
          saveStoredConversations(json.conversations);
          return json.conversations;
        }
      }
    } catch (apiErr) {
      console.warn('[getConversations] API fetch warning, fallback to direct:', apiErr);
    }
  }

  // B. Fallback: Supabase veya Local Storage
  const stored = getStoredConversations().filter(
    (c) => c.buyer_id === userId || c.company_id === userId
  );

  return stored.sort(
    (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
  );
}

// 2. MESAJLARI GETİR (Merkezi API Öncelikli)
export async function getMessages(conversationId: string): Promise<Message[]> {
  if (!conversationId) return [];

  // A. Tarayıcıdaysa Merkezi API'den çek
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/messages/list?conversationId=${encodeURIComponent(conversationId)}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.messages)) {
          saveStoredMessages(conversationId, json.messages);
          return json.messages;
        }
      }
    } catch (apiErr) {
      console.warn('[getMessages] API fetch warning, fallback to local:', apiErr);
    }
  }

  // B. Fallback: Yerel Depo
  const stored = getStoredMessages(conversationId);
  return stored.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

// 3. MESAJ GÖNDER (Merkezi API Öncelikli)
export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string,
  attachmentUrl?: string | null
): Promise<{
  success: boolean;
  message?: Message;
  error?: string;
  isMasked?: boolean;
  detectedTypes?: MaskDetectedType[];
  infoNotice?: string;
  logId?: string;
}> {
  if (!body.trim() && !attachmentUrl) {
    return { success: false, error: 'Mesaj içeriği boş olamaz.' };
  }

  // A. Tarayıcıdaysa Merkezi API'ye POST et
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          senderId,
          body,
          attachmentUrl,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.message) {
          // Yerel depoyu da güncelle
          const existing = getStoredMessages(conversationId);
          if (!existing.some((m) => m.id === json.message.id)) {
            existing.push(json.message);
            saveStoredMessages(conversationId, existing);
          }
          return json;
        }
      }
    } catch (apiErr: any) {
      console.warn('[sendMessage] API send warning, fallback to direct:', apiErr?.message);
    }
  }

  // B. Fallback: Yerel ve Supabase doğrudan gönderim
  const maskRes = sanitizeContent(body.trim());
  const finalBody = maskRes.sanitizedText;
  const nowIso = new Date().toISOString();
  const generatedId = generateUUID();

  const newMsg: Message = {
    id: generatedId,
    conversation_id: conversationId,
    sender_id: senderId,
    body: finalBody,
    content: finalBody,
    attachment_url: attachmentUrl || null,
    is_read: false,
    created_at: nowIso,
  };

  const existingMsgs = getStoredMessages(conversationId);
  existingMsgs.push(newMsg);
  saveStoredMessages(conversationId, existingMsgs);

  return {
    success: true,
    message: newMsg,
    isMasked: maskRes.isMasked,
    detectedTypes: maskRes.detectedTypes,
    infoNotice: maskRes.infoNotice,
  };
}

// 4. KONUŞMA BAŞLAT (Merkezi API Öncelikli)
export async function startConversation({
  buyerId,
  companyId,
  listingId,
  quoteId,
  companyName,
  buyerName,
  listingTitle,
  initialMessage,
}: {
  buyerId: string;
  companyId: string;
  listingId?: string;
  quoteId?: string;
  companyName?: string;
  buyerName?: string;
  listingTitle?: string;
  initialMessage?: string;
}): Promise<{ success: boolean; conversation?: DemoConversation; error?: string }> {
  if (!buyerId || !companyId) {
    return { success: false, error: 'Alıcı ve firma bilgileri gereklidir.' };
  }

  // A. Tarayıcıdaysa Merkezi API'ye POST et
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/messages/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerId,
          companyId,
          listingId,
          quoteId,
          companyName,
          buyerName,
          listingTitle,
          initialMessage,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.conversation) {
          const convs = getStoredConversations();
          if (!convs.some((c) => c.id === json.conversation.id)) {
            convs.unshift(json.conversation);
            saveStoredConversations(convs);
          }
          return json;
        }
      }
    } catch (apiErr) {
      console.warn('[startConversation] API warning, fallback to direct:', apiErr);
    }
  }

  // B. Fallback: Yerel Depo
  const existingConvs = getStoredConversations();
  const existing = existingConvs.find(
    (c) =>
      c.buyer_id === buyerId &&
      c.company_id === companyId &&
      (!listingId || c.listing_id === listingId)
  );

  if (existing) {
    if (initialMessage) {
      await sendMessage(existing.id, buyerId, initialMessage);
    }
    return { success: true, conversation: existing };
  }

  const nowIso = new Date().toISOString();
  const generatedConvId = generateUUID();

  const newConv: DemoConversation = {
    id: generatedConvId,
    buyer_id: buyerId,
    company_id: companyId,
    listing_id: listingId || null,
    quote_id: quoteId || null,
    is_blocked: false,
    created_at: nowIso,
    updated_at: nowIso,
    other_user_name: companyName || 'Firma Yetkilisi',
    other_user_role: 'company',
    listing_title: listingTitle,
    unread_count: 0,
    last_message: initialMessage || 'Konuşma başlatıldı.',
    last_message_at: nowIso,
    company_name: companyName,
    buyer_name: buyerName,
  };

  existingConvs.unshift(newConv);
  saveStoredConversations(existingConvs);

  if (initialMessage) {
    await sendMessage(newConv.id, buyerId, initialMessage);
  }

  return { success: true, conversation: newConv };
}

// 5. OKUNDU İŞARETLE (Merkezi API Öncelikli)
export async function markConversationAsRead(
  conversationId: string,
  userId: string
): Promise<void> {
  const convs = getStoredConversations();
  const conv = convs.find((c) => c.id === conversationId);
  if (conv) {
    conv.unread_count = 0;
    saveStoredConversations(convs);
  }

  const msgs = getStoredMessages(conversationId);
  if (msgs.length > 0) {
    msgs.forEach((m) => {
      if (m.sender_id !== userId) {
        m.is_read = true;
      }
    });
    saveStoredMessages(conversationId, msgs);
  }

  // Sunucu API'sini çağır
  if (typeof window !== 'undefined') {
    try {
      await fetch('/api/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, userId }),
      });
    } catch {}
  }

  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured && UUID_REGEX.test(conversationId) && UUID_REGEX.test(userId)) {
      await supabase
        .from('messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId);
    }
  } catch {}
}

// 6. ŞİKAYET ET
export async function reportMessage(
  messageId: string,
  reporterId: string,
  reason: string
): Promise<{ success: boolean }> {
  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured) {
      await supabase.from('compliance_reports').insert({
        reporter_id: UUID_REGEX.test(reporterId) ? reporterId : null,
        entity_id: messageId,
        entity_type: 'message',
        reason,
        created_at: new Date().toISOString(),
      });
    }
  } catch {}

  return { success: true };
}

// 7. KULLANICIYI ENGELLE (Merkezi API Öncelikli)
export async function blockUser(
  conversationId: string,
  blockerId: string
): Promise<{ success: boolean }> {
  const convs = getStoredConversations();
  const conv = convs.find((c) => c.id === conversationId);
  if (conv) {
    conv.is_blocked = true;
    saveStoredConversations(convs);
  }

  // Sunucu API'sini çağır
  if (typeof window !== 'undefined') {
    try {
      await fetch('/api/messages/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, blockerId }),
      });
    } catch {}
  }

  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
      await supabase
        .from('conversations')
        .update({ is_blocked: true })
        .eq('id', conversationId);
    }
  } catch {}

  return { success: true };
}
