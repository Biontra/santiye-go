import fs from 'fs';
import path from 'path';
import { Conversation, Message } from '@/types/database';
import { sanitizeContent, MaskDetectedType } from '@/lib/security/contact-masker';
import { createClient as createSupabaseDirectClient } from '@supabase/supabase-js';

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

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'placeholder-key';
  return createSupabaseDirectClient(supabaseUrl, supabaseKey);
}

function ensureLocalDataFile(): ChatStoreData {
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
  } catch {
    return { conversations: [], messages: {} };
  }
}

function saveLocalDataFile(data: ChatStoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kullanıcı kimliğini (user_id / auth UUID) varsa sahip olduğu firma ID'leri ile eşleştirir.
 */
export async function resolveAssociatedIds(userId: string): Promise<string[]> {
  const ids = new Set<string>();
  if (!userId) return [];
  ids.add(userId);

  try {
    const supabase = getSupabaseClient();
    const { data: companies } = await supabase
      .from('companies')
      .select('id')
      .eq('user_id', userId);

    if (companies) {
      companies.forEach((c) => ids.add(c.id));
    }
  } catch {}

  return Array.from(ids);
}

/**
 * Kullanıcının konuşma listesini getirir (Canlı Supabase + Yerel Yedek).
 */
export async function serverGetConversations(userId: string): Promise<ServerConversation[]> {
  const supabase = getSupabaseClient();
  const isSupabaseConfigured =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  if (isSupabaseConfigured) {
    try {
      const associatedIds = await resolveAssociatedIds(userId);

      // 1. Supabase conversations tablosundan çek
      let query = supabase
        .from('conversations')
        .select(`
          *,
          buyer:profiles!conversations_buyer_id_fkey(id, full_name, role),
          company:companies!conversations_company_id_fkey(id, name, logo_url, user_id),
          listing:listings!conversations_listing_id_fkey(id, title)
        `)
        .order('last_message_at', { ascending: false });

      if (associatedIds.length > 0) {
        query = query.or(
          `buyer_id.in.(${associatedIds.join(',')}),company_id.in.(${associatedIds.join(',')})`
        );
      }

      const { data: dbConversations, error: convError } = await query;

      if (!convError && dbConversations && dbConversations.length > 0) {
        const enriched: ServerConversation[] = [];

        for (const c of dbConversations) {
          const isUserBuyer = c.buyer_id === userId || (c.company && c.company.user_id !== userId);

          // Son mesajı ve okunmamış sayısını çek
          const { data: lastMsgData } = await supabase
            .from('messages')
            .select('content, created_at')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const { count: unreadCount } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', c.id)
            .neq('sender_id', userId)
            .eq('is_read', false);

          const otherName = isUserBuyer
            ? c.company?.name || 'Tedarikçi Firma'
            : c.buyer?.full_name || 'Alıcı Müşteri';
          const otherRole = isUserBuyer ? 'company' : 'buyer';

          enriched.push({
            id: c.id,
            buyer_id: c.buyer_id,
            company_id: c.company_id,
            listing_id: c.listing_id || undefined,
            quote_request_id: c.quote_request_id || undefined,
            created_at: c.created_at,
            updated_at: c.updated_at,
            other_user_name: otherName,
            other_user_role: otherRole,
            company_name: c.company?.name,
            buyer_name: c.buyer?.full_name,
            listing_title: c.listing?.title,
            unread_count: unreadCount || 0,
            last_message: lastMsgData?.content || 'Konuşma başlatıldı.',
            last_message_at: lastMsgData?.created_at || c.last_message_at || c.created_at,
          });
        }

        return enriched;
      }
    } catch (err) {
      console.warn('[server-message-store] Supabase get conversations error, checking fallback:', err);
    }
  }

  // Yerel Dosya Yedeği
  const store = ensureLocalDataFile();
  const associated = await resolveAssociatedIds(userId);
  return store.conversations.filter(
    (c) =>
      associated.includes(c.buyer_id) ||
      associated.includes(c.company_id) ||
      c.buyer_id === userId ||
      c.company_id === userId
  );
}

/**
 * Bir konuşmanın mesajlarını getirir.
 */
export async function serverGetMessages(conversationId: string): Promise<Message[]> {
  const supabase = getSupabaseClient();
  const isSupabaseConfigured =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  if (isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        return data.map((m: any) => ({
          id: m.id,
          conversation_id: m.conversation_id,
          sender_id: m.sender_id,
          body: m.content,
          content: m.content,
          attachment_url: m.attachment_url,
          is_read: m.is_read,
          created_at: m.created_at,
        }));
      }
    } catch (err) {
      console.warn('[server-message-store] Supabase get messages error:', err);
    }
  }

  const store = ensureLocalDataFile();
  return store.messages[conversationId] || [];
}

/**
 * Konuşma başlatır (Canlı Supabase + Yerel Senkronizasyon).
 */
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
  const supabase = getSupabaseClient();
  const isSupabaseConfigured =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  let resolvedCompanyId = companyId;
  let resolvedListingId = listingId && UUID_REGEX.test(listingId) ? listingId : null;

  if (isSupabaseConfigured) {
    try {
      // 1. Eğer companyId aslında bir user_id ise companies tablosundan şirket UUID'sini bul
      if (UUID_REGEX.test(companyId)) {
        const { data: comp } = await supabase
          .from('companies')
          .select('id')
          .or(`id.eq.${companyId},user_id.eq.${companyId}`)
          .maybeSingle();

        if (comp?.id) {
          resolvedCompanyId = comp.id;
        }
      }

      // 2. Canlı veritabanında mevcut konuşmayı ara
      let query = supabase
        .from('conversations')
        .select(`
          *,
          buyer:profiles!conversations_buyer_id_fkey(id, full_name, role),
          company:companies!conversations_company_id_fkey(id, name, logo_url),
          listing:listings!conversations_listing_id_fkey(id, title)
        `)
        .eq('buyer_id', buyerId)
        .eq('company_id', resolvedCompanyId);

      if (resolvedListingId) {
        query = query.eq('listing_id', resolvedListingId);
      }

      const { data: existingConv } = await query.maybeSingle();

      if (existingConv) {
        if (initialMessage && initialMessage.trim()) {
          await serverSendMessage({
            conversationId: existingConv.id,
            senderId: buyerId,
            body: initialMessage,
          });
        }

        const formatted: ServerConversation = {
          id: existingConv.id,
          buyer_id: existingConv.buyer_id,
          company_id: existingConv.company_id,
          listing_id: existingConv.listing_id || undefined,
          quote_request_id: existingConv.quote_request_id || undefined,
          created_at: existingConv.created_at,
          updated_at: existingConv.updated_at,
          other_user_name: existingConv.company?.name || companyName || 'Firma',
          other_user_role: 'company',
          company_name: existingConv.company?.name || companyName,
          buyer_name: existingConv.buyer?.full_name || buyerName,
          listing_title: existingConv.listing?.title || listingTitle,
          unread_count: 0,
          last_message: initialMessage || 'Konuşma başlatıldı.',
          last_message_at: new Date().toISOString(),
        };

        return { success: true, conversation: formatted };
      }

      // 3. Mevcut yoksa Canlı Supabase'e ekle
      const { data: newDbConv, error: insertConvErr } = await supabase
        .from('conversations')
        .insert({
          buyer_id: buyerId,
          company_id: resolvedCompanyId,
          listing_id: resolvedListingId,
          quote_request_id: quoteId && UUID_REGEX.test(quoteId) ? quoteId : null,
          last_message_at: new Date().toISOString(),
        })
        .select(`
          *,
          buyer:profiles!conversations_buyer_id_fkey(id, full_name, role),
          company:companies!conversations_company_id_fkey(id, name, logo_url),
          listing:listings!conversations_listing_id_fkey(id, title)
        `)
        .single();

      if (!insertConvErr && newDbConv) {
        if (initialMessage && initialMessage.trim()) {
          await serverSendMessage({
            conversationId: newDbConv.id,
            senderId: buyerId,
            body: initialMessage,
          });
        }

        const formatted: ServerConversation = {
          id: newDbConv.id,
          buyer_id: newDbConv.buyer_id,
          company_id: newDbConv.company_id,
          listing_id: newDbConv.listing_id || undefined,
          quote_request_id: newDbConv.quote_request_id || undefined,
          created_at: newDbConv.created_at,
          updated_at: newDbConv.updated_at,
          other_user_name: newDbConv.company?.name || companyName || 'Firma',
          other_user_role: 'company',
          company_name: newDbConv.company?.name || companyName,
          buyer_name: newDbConv.buyer?.full_name || buyerName,
          listing_title: newDbConv.listing?.title || listingTitle,
          unread_count: 0,
          last_message: initialMessage || 'Konuşma başlatıldı.',
          last_message_at: newDbConv.created_at,
        };

        return { success: true, conversation: formatted };
      }
    } catch (err) {
      console.warn('[server-message-store] Supabase start conversation error, fallback to local:', err);
    }
  }

  // Yerel Dosya Yedeği
  const store = ensureLocalDataFile();
  const generatedId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `conv-${Date.now()}`;
  const nowIso = new Date().toISOString();

  const newLocalConv: ServerConversation = {
    id: generatedId,
    buyer_id: buyerId,
    company_id: resolvedCompanyId,
    listing_id: listingId,
    quote_request_id: quoteId,
    created_at: nowIso,
    updated_at: nowIso,
    other_user_name: companyName || 'Firma',
    other_user_role: 'company',
    company_name: companyName,
    buyer_name: buyerName,
    listing_title: listingTitle,
    unread_count: 0,
    last_message: initialMessage || 'Konuşma başlatıldı.',
    last_message_at: nowIso,
  };

  store.conversations.push(newLocalConv);
  store.messages[generatedId] = [];
  saveLocalDataFile(store);

  if (initialMessage && initialMessage.trim()) {
    await serverSendMessage({
      conversationId: generatedId,
      senderId: buyerId,
      body: initialMessage,
    });
  }

  return { success: true, conversation: newLocalConv };
}

/**
 * Mesaj gönderir (İletişim maskeleme ve canlı Supabase yazımı).
 */
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

  // 1. İletişim koruması ve maskeleme (Prompt 9A & 11)
  const maskRes = sanitizeContent(body.trim());
  const finalContent = maskRes.sanitizedText;
  const nowIso = new Date().toISOString();

  const supabase = getSupabaseClient();
  const isSupabaseConfigured =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  let insertedMessage: Message | null = null;

  if (isSupabaseConfigured && UUID_REGEX.test(conversationId) && UUID_REGEX.test(senderId)) {
    try {
      const { data: dbMsg, error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content: finalContent,
          attachment_url: attachmentUrl || null,
          is_read: false,
        })
        .select()
        .single();

      if (!msgError && dbMsg) {
        insertedMessage = {
          id: dbMsg.id,
          conversation_id: dbMsg.conversation_id,
          sender_id: dbMsg.sender_id,
          body: dbMsg.content,
          content: dbMsg.content,
          attachment_url: dbMsg.attachment_url,
          is_read: dbMsg.is_read,
          created_at: dbMsg.created_at,
        };

        // Konuşmanın son mesaj tarihini güncelle
        await supabase
          .from('conversations')
          .update({ last_message_at: nowIso, updated_at: nowIso })
          .eq('id', conversationId);
      }
    } catch (err) {
      console.warn('[server-message-store] Supabase insert message error:', err);
    }
  }

  // Yerel Dosya Yedeği Senkronizasyonu
  const store = ensureLocalDataFile();
  const fallbackId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}`;
  const localMsg: Message = insertedMessage || {
    id: fallbackId,
    conversation_id: conversationId,
    sender_id: senderId,
    body: finalContent,
    content: finalContent,
    attachment_url: attachmentUrl || null,
    is_read: false,
    created_at: nowIso,
  };

  if (!store.messages[conversationId]) {
    store.messages[conversationId] = [];
  }
  store.messages[conversationId].push(localMsg);

  const conv = store.conversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.last_message = finalContent;
    conv.last_message_at = nowIso;
    conv.updated_at = nowIso;
  }
  saveLocalDataFile(store);

  return {
    success: true,
    message: localMsg,
    isMasked: maskRes.isMasked,
    detectedTypes: maskRes.detectedTypes,
    infoNotice: maskRes.isMasked
      ? 'Güvenliğiniz ve komisyon kaçağının önlenmesi için telefon, e-posta veya harici iletişim bilgileri sistem tarafından otomatik olarak gizlenmiştir.'
      : undefined,
  };
}

/**
 * Mesajları okundu olarak işaretler.
 */
export async function serverMarkAsRead(conversationId: string, userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const isSupabaseConfigured =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  if (isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
    try {
      await supabase
        .from('messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .eq('is_read', false);
    } catch {}
  }

  const store = ensureLocalDataFile();
  const msgs = store.messages[conversationId];
  if (msgs) {
    msgs.forEach((m) => {
      if (m.sender_id !== userId) m.is_read = true;
    });
    saveLocalDataFile(store);
  }

  return true;
}

export async function serverBlockUser(conversationId: string, _blockerId: string): Promise<boolean> {
  const store = ensureLocalDataFile();
  const conv = store.conversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.is_blocked = true;
    saveLocalDataFile(store);
  }
  return true;
}
