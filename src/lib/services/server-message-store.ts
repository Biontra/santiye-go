import { createClient } from '@/lib/supabase/server';
import { Conversation, Message } from '@/types/database';
import { sanitizeContent, MaskDetectedType } from '@/lib/security/contact-masker';

export interface ServerConversation extends Conversation {
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Oturum açmış kullanıcının konuşma listesini canlı Supabase veritabanından çeker.
 * RLS ilkelerine ve seller_id / buyer_id auth kimlik modeline tam uyumludur.
 */
export async function serverGetConversations(userId?: string): Promise<ServerConversation[]> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Konuşmaları görüntülemek için oturum açmalısınız.');
  }

  const currentUserId = user.id;

  // 1. Önce conversations tablosundaki konuşmaları ilişkisiz (düz select) olarak çek.
  // PostgREST schema cache uyuşmazlıklarını ve yabancı anahtar kısıt hatalarını %100 önler.
  let convRows: any[] = [];

  const queryWithSeller = await supabase
    .from('conversations')
    .select('id, buyer_id, seller_id, company_id, listing_id, quote_request_id, last_message_at, created_at, updated_at')
    .or(`buyer_id.eq.${currentUserId},seller_id.eq.${currentUserId}`)
    .order('last_message_at', { ascending: false });

  if (queryWithSeller.error) {
    // Eğer seller_id henüz canlı DB'de eklenmemişse veya hata verirse yedek sorgu:
    console.warn('[serverGetConversations] seller_id ile sorgu başarısız, temel kolonlarla deneniyor:', queryWithSeller.error.message);
    const fallbackQuery = await supabase
      .from('conversations')
      .select('id, buyer_id, company_id, listing_id, quote_request_id, last_message_at, created_at, updated_at')
      .eq('buyer_id', currentUserId)
      .order('created_at', { ascending: false });

    if (fallbackQuery.error) {
      console.error('[serverGetConversations] Fallback query error:', fallbackQuery.error);
      throw new Error(`Konuşmalar yüklenirken veritabanı hatası oluştu: ${fallbackQuery.error.message}`);
    }
    convRows = fallbackQuery.data || [];
  } else {
    convRows = queryWithSeller.data || [];
  }

  if (!convRows || convRows.length === 0) {
    return [];
  }

  // 2. İlgili profilleri, firmaları ve ilanları toplu (batch in(...)) olarak çek
  const userIds = Array.from(new Set(convRows.flatMap((c) => [c.buyer_id, c.seller_id]).filter(Boolean))) as string[];
  const companyIds = Array.from(new Set(convRows.map((c) => c.company_id).filter(Boolean))) as string[];
  const listingIds = Array.from(new Set(convRows.map((c) => c.listing_id).filter(Boolean))) as string[];

  const [profilesRes, companiesRes, listingsRes] = await Promise.all([
    userIds.length > 0
      ? supabase.from('profiles').select('id, full_name, role').in('id', userIds)
      : Promise.resolve({ data: [] }),
    companyIds.length > 0
      ? supabase.from('companies').select('id, name, logo_url, user_id').in('id', companyIds)
      : Promise.resolve({ data: [] }),
    listingIds.length > 0
      ? supabase.from('listings').select('id, title').in('id', listingIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profilesMap = new Map<string, any>((profilesRes.data || []).map((p: any) => [p.id, p]));
  const companiesMap = new Map<string, any>((companiesRes.data || []).map((co: any) => [co.id, co]));
  const listingsMap = new Map<string, any>((listingsRes.data || []).map((l: any) => [l.id, l]));

  const enriched: ServerConversation[] = [];

  for (const c of convRows) {
    const isUserBuyer = c.buyer_id === currentUserId;
    const buyerProfile = profilesMap.get(c.buyer_id);
    const sellerProfile = c.seller_id ? profilesMap.get(c.seller_id) : null;
    const company = c.company_id ? companiesMap.get(c.company_id) : null;
    const listing = c.listing_id ? listingsMap.get(c.listing_id) : null;

    const otherUser = isUserBuyer ? sellerProfile : buyerProfile;
    const otherCompanyName = company?.name;

    // Son mesajı çek
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('content, created_at')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Okunmamış mesaj sayısını hesapla
    const { count: unreadCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', c.id)
      .neq('sender_id', currentUserId)
      .eq('is_read', false);

    const otherName = isUserBuyer
      ? otherCompanyName || otherUser?.full_name || 'Tedarikçi Firma'
      : otherUser?.full_name || 'Alıcı Müşteri';

    const otherRole = isUserBuyer ? 'company' : 'buyer';
    const otherId = isUserBuyer ? (c.seller_id || company?.user_id) : c.buyer_id;

    enriched.push({
      id: c.id,
      buyer_id: c.buyer_id,
      seller_id: c.seller_id,
      company_id: c.company_id,
      listing_id: c.listing_id || undefined,
      quote_request_id: c.quote_request_id || undefined,
      created_at: c.created_at,
      updated_at: c.updated_at,
      other_user_name: otherName,
      other_user_role: otherRole,
      other_user_id: otherId,
      company_name: otherCompanyName,
      buyer_name: buyerProfile?.full_name,
      listing_title: listing?.title,
      unread_count: unreadCount || 0,
      last_message: lastMsg?.content || 'Konuşma başlatıldı.',
      last_message_at: lastMsg?.created_at || c.last_message_at || c.created_at,
    });
  }

  return enriched;
}

/**
 * Belirli bir konuşmanın mesajlarını canlı veritabanından çeker.
 */
export async function serverGetMessages(conversationId: string): Promise<Message[]> {
  if (!conversationId || !UUID_REGEX.test(conversationId)) {
    throw new Error('Geçersiz konuşma kimliği.');
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Mesajları görüntülemek için oturum açmalısınız.');
  }

  const { data: dbMsgs, error: msgError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error('[serverGetMessages] Supabase query error:', msgError);
    throw new Error(`Mesajlar yüklenirken hata oluştu: ${msgError.message}`);
  }

  return (dbMsgs || []).map((m: any) => ({
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

/**
 * Konuşma bul veya oluştur (Atomik PostgreSQL RPC çağrısı).
 */
export async function serverStartConversation({
  listingId,
  companyId,
  quoteRequestId,
  initialMessage,
}: {
  listingId?: string;
  companyId?: string;
  quoteRequestId?: string;
  initialMessage?: string;
}): Promise<{ success: boolean; conversationId?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Konuşma başlatmak için oturum açmalısınız.');
  }

  // Atomik veritabanı RPC fonksiyonunu çağır
  const { data: rpcRes, error: rpcError } = await supabase.rpc('get_or_create_conversation', {
    p_listing_id: listingId && UUID_REGEX.test(listingId) ? listingId : null,
    p_company_id: companyId && UUID_REGEX.test(companyId) ? companyId : null,
    p_quote_request_id: quoteRequestId && UUID_REGEX.test(quoteRequestId) ? quoteRequestId : null,
    p_initial_message: initialMessage ? initialMessage.trim() : null,
  });

  if (rpcError) {
    console.error('[serverStartConversation] RPC error:', rpcError);
    throw new Error(rpcError.message || 'Konuşma oluşturulamadı.');
  }

  return {
    success: true,
    conversationId: rpcRes?.conversation_id,
  };
}

/**
 * Mesaj gönderir (Atomik RPC, sunucu tarafı 9A maskeleme ve bildirim).
 */
export async function serverSendMessage({
  conversationId,
  body,
  attachmentUrl,
  clientMessageId,
}: {
  conversationId: string;
  body: string;
  attachmentUrl?: string | null;
  clientMessageId?: string;
}): Promise<{
  success: boolean;
  message?: Message;
  isMasked?: boolean;
  infoNotice?: string;
  error?: string;
}> {
  if (!conversationId || !UUID_REGEX.test(conversationId)) {
    throw new Error('Geçersiz konuşma kimliği.');
  }

  if (!body.trim() && !attachmentUrl) {
    throw new Error('Mesaj içeriği veya fotoğraf eki zorunludur.');
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Mesaj göndermek için oturum açmalısınız.');
  }

  // Atomik veritabanı RPC fonksiyonunu çağır
  const { data: rpcRes, error: rpcError } = await supabase.rpc('send_message_rpc', {
    p_conversation_id: conversationId,
    p_content: body ? body.trim() : '',
    p_attachment_url: attachmentUrl || null,
    p_client_message_id: clientMessageId || null,
  });

  if (rpcError) {
    console.error('[serverSendMessage] RPC error:', rpcError);
    throw new Error(rpcError.message || 'Mesaj iletilemedi.');
  }

  const rawMsg = rpcRes?.message;
  const formattedMsg: Message | undefined = rawMsg
    ? {
        id: rawMsg.id,
        conversation_id: rawMsg.conversation_id,
        sender_id: rawMsg.sender_id,
        body: rawMsg.content,
        content: rawMsg.content,
        attachment_url: rawMsg.attachment_url,
        is_read: rawMsg.is_read,
        created_at: rawMsg.created_at,
      }
    : undefined;

  return {
    success: true,
    message: formattedMsg,
    isMasked: rpcRes?.is_masked,
    infoNotice: rpcRes?.info_notice,
  };
}

/**
 * Mesajları okundu olarak işaretler (Atomik RPC).
 */
export async function serverMarkAsRead(conversationId: string): Promise<boolean> {
  if (!conversationId || !UUID_REGEX.test(conversationId)) return false;

  const supabase = await createClient();
  const { data: rpcRes, error: rpcError } = await supabase.rpc('mark_messages_read', {
    p_conversation_id: conversationId,
  });

  if (rpcError) {
    console.error('[serverMarkAsRead] RPC error:', rpcError);
    return false;
  }

  return !!rpcRes?.success;
}

/**
 * Kullanıcıyı engeller (Atomik RPC).
 */
export async function serverBlockUser(blockedUserId: string): Promise<boolean> {
  if (!blockedUserId || !UUID_REGEX.test(blockedUserId)) {
    throw new Error('Geçersiz kullanıcı kimliği.');
  }

  const supabase = await createClient();
  const { data: rpcRes, error: rpcError } = await supabase.rpc('block_user_rpc', {
    p_blocked_id: blockedUserId,
  });

  if (rpcError) {
    throw new Error(rpcError.message || 'Kullanıcı engellenemedi.');
  }

  return !!rpcRes?.success;
}

/**
 * Şikayet oluşturur (Atomik RPC).
 */
export async function serverReportEntity({
  reportedUserId,
  messageId,
  listingId,
  reason,
  details,
}: {
  reportedUserId?: string;
  messageId?: string;
  listingId?: string;
  reason: string;
  details?: string;
}): Promise<{ success: boolean; reportId?: string }> {
  const supabase = await createClient();
  const { data: rpcRes, error: rpcError } = await supabase.rpc('report_entity_rpc', {
    p_reported_user_id: reportedUserId && UUID_REGEX.test(reportedUserId) ? reportedUserId : null,
    p_message_id: messageId && UUID_REGEX.test(messageId) ? messageId : null,
    p_listing_id: listingId && UUID_REGEX.test(listingId) ? listingId : null,
    p_reason: reason || 'diger',
    p_details: details || null,
  });

  if (rpcError) {
    throw new Error(rpcError.message || 'Şikayet iletilemedi.');
  }

  return { success: true, reportId: rpcRes?.report_id };
}
