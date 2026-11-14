import fs from 'fs';
import path from 'path';
import { Conversation, Message } from '@/types/database';
import { sanitizeContent, MaskDetectedType } from '@/lib/security/contact-masker';
import { createClient } from '@/lib/supabase/client';

export interface ServerConversation extends Conversation {
  other_user_name: string;
  other_user_role: string;
  listing_title?: string;
  unread_count: number;
  last_message?: string;
  last_message_at?: string;
  company_name?: string;
  buyer_name?: string;
}

interface ChatStoreData {
  conversations: ServerConversation[];
  messages: Record<string, Message[]>;
}

const DATA_DIR = path.join(process.cwd(), '.runtime-data');
const DATA_FILE = path.join(DATA_DIR, 'chat-store.json');

function ensureDataFile(): ChatStoreData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      const initialData: ChatStoreData = { conversations: [], messages: {} };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
      return initialData;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw) as ChatStoreData;
  } catch (err) {
    console.warn('[server-message-store] read file error:', err);
    return { conversations: [], messages: {} };
  }
}

function saveDataFile(data: ChatStoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[server-message-store] write file error:', err);
  }
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function serverGetConversations(userId: string): Promise<ServerConversation[]> {
  if (!userId) return [];
  const store = ensureDataFile();

  // 1. Supabase'den çekmeyi dene (eğer canlı db açıksa)
  const supabaseResults: ServerConversation[] = [];
  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured && UUID_REGEX.test(userId)) {
      let companyIds = [userId];
      const { data: comps } = await supabase.from('companies').select('id').eq('user_id', userId);
      if (comps && comps.length > 0) {
        comps.forEach((c) => {
          if (c.id && !companyIds.includes(c.id)) companyIds.push(c.id);
        });
      }

      const orFilter = [`buyer_id.eq.${userId}`, ...companyIds.map((c) => `company_id.eq.${c}`)].join(',');
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          buyer:profiles(full_name),
          company:companies(name),
          listing:listings(title),
          messages:messages(content, created_at, is_read, sender_id)
        `)
        .or(orFilter)
        .order('updated_at', { ascending: false });

      if (!error && data) {
        data.forEach((d: any) => {
          const isUserBuyer = d.buyer_id === userId;
          const otherName = isUserBuyer
            ? d.company?.name || d.company_name || 'Firma Yetkilisi'
            : d.buyer?.full_name || d.buyer_name || 'Alıcı Müşteri';
          const msgs = d.messages || [];
          const sorted = [...msgs].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const last = sorted[sorted.length - 1];

          supabaseResults.push({
            ...d,
            other_user_name: otherName,
            other_user_role: isUserBuyer ? 'company' : 'buyer',
            listing_title: d.listing?.title || d.listing_title,
            unread_count: msgs.filter((m: any) => !m.is_read && m.sender_id !== userId).length,
            last_message: last?.content || last?.body,
            last_message_at: last?.created_at || d.updated_at,
          });
        });
      }
    }
  } catch (err) {
    // Supabase sessizce fallback
  }

  // 2. Sunucu yerel deposundaki konuşmaları filtrele
  const localMatched = store.conversations.filter(
    (c) => c.buyer_id === userId || c.company_id === userId
  );

  // Birleştir
  const merged: ServerConversation[] = [...supabaseResults];
  for (const loc of localMatched) {
    const isUserBuyer = loc.buyer_id === userId;
    const existingIdx = merged.findIndex((m) => m.id === loc.id);
    const msgs = store.messages[loc.id] || [];
    const unread = msgs.filter((m) => !m.is_read && m.sender_id !== userId).length;
    const last = msgs[msgs.length - 1];

    const item: ServerConversation = {
      ...loc,
      other_user_name: isUserBuyer
        ? loc.company_name || loc.other_user_name || 'Firma Yetkilisi'
        : loc.buyer_name || loc.other_user_name || 'Alıcı Müşteri',
      other_user_role: isUserBuyer ? 'company' : 'buyer',
      unread_count: unread,
      last_message: last ? (last.body || last.content) : loc.last_message,
      last_message_at: last ? last.created_at : loc.last_message_at,
    };

    if (existingIdx !== -1) {
      merged[existingIdx] = { ...merged[existingIdx], ...item };
    } else {
      merged.push(item);
    }
  }

  return merged.sort(
    (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
  );
}

export async function serverGetMessages(conversationId: string): Promise<Message[]> {
  if (!conversationId) return [];
  const store = ensureDataFile();

  const results: Message[] = [];

  // 1. Supabase'den çekmeyi dene
  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        data.forEach((d: any) => {
          results.push({
            ...d,
            body: d.content || d.body,
            content: d.content || d.body,
          });
        });
      }
    }
  } catch {}

  // 2. Sunucu yerel deposundaki mesajlarla birleştir (duplicate id önle)
  const localMsgs = store.messages[conversationId] || [];
  for (const lm of localMsgs) {
    if (!results.some((r) => r.id === lm.id)) {
      results.push({
        ...lm,
        body: lm.body || lm.content,
        content: lm.body || lm.content,
      });
    }
  }

  return results.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export async function serverStartConversation({
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
}): Promise<{ success: boolean; conversation: ServerConversation }> {
  const store = ensureDataFile();

  // Var olan konuşmayı ara
  let existing = store.conversations.find(
    (c) =>
      c.buyer_id === buyerId &&
      c.company_id === companyId &&
      (!listingId || c.listing_id === listingId)
  );

  const nowIso = new Date().toISOString();

  if (existing) {
    if (initialMessage) {
      await serverSendMessage({
        conversationId: existing.id,
        senderId: buyerId,
        body: initialMessage,
      });
    }
    return { success: true, conversation: existing };
  }

  const newId = generateUUID();
  const newConv: ServerConversation = {
    id: newId,
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

  store.conversations.unshift(newConv);
  store.messages[newId] = [];
  saveDataFile(store);

  // Canlı Supabase'e de senkronize etmeyi dene
  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured && UUID_REGEX.test(buyerId) && UUID_REGEX.test(companyId)) {
      await supabase.from('conversations').insert({
        id: newId,
        buyer_id: buyerId,
        company_id: companyId,
        listing_id: listingId && UUID_REGEX.test(listingId) ? listingId : null,
      });
    }
  } catch {}

  if (initialMessage) {
    await serverSendMessage({
      conversationId: newId,
      senderId: buyerId,
      body: initialMessage,
    });
  }

  return { success: true, conversation: newConv };
}

export async function serverSendMessage({
  conversationId,
  senderId,
  body,
  attachmentUrl,
}: {
  conversationId: string;
  senderId: string;
  body: string;
  attachmentUrl?: string | null;
}): Promise<{
  success: boolean;
  message: Message;
  isMasked?: boolean;
  detectedTypes?: MaskDetectedType[];
  infoNotice?: string;
}> {
  if (!body.trim() && !attachmentUrl) {
    throw new Error('Mesaj içeriği boş olamaz.');
  }

  const store = ensureDataFile();

  // Maskeleme
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

  // Sunucu deposuna kaydet
  if (!store.messages[conversationId]) {
    store.messages[conversationId] = [];
  }
  store.messages[conversationId].push(newMsg);

  // Konuşmayı güncelle
  const conv = store.conversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.last_message = finalBody;
    conv.last_message_at = nowIso;
    conv.updated_at = nowIso;
  }
  saveDataFile(store);

  // Supabase'e de senkronize etmeyi dene
  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured && UUID_REGEX.test(conversationId) && UUID_REGEX.test(senderId)) {
      await supabase.from('messages').insert({
        id: generatedId,
        conversation_id: conversationId,
        sender_id: senderId,
        content: finalBody,
        attachment_url: attachmentUrl || null,
        is_read: false,
      });

      await supabase
        .from('conversations')
        .update({ updated_at: nowIso, last_message_at: nowIso })
        .eq('id', conversationId);
    }
  } catch {}

  return {
    success: true,
    message: newMsg,
    isMasked: maskRes.isMasked,
    detectedTypes: maskRes.detectedTypes,
    infoNotice: maskRes.infoNotice,
  };
}
