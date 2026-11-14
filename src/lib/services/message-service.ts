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

// Geriye dönük uyumluluk için boş demo koleksiyonları
export const DEMO_CONVERSATIONS: DemoConversation[] = [];
export const DEMO_MESSAGES: Record<string, Message[]> = {};

// Node.js test ve SSR ortamı için in-memory defter
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

export async function getConversations(userId: string): Promise<DemoConversation[]> {
  if (!userId) return [];

  let results: DemoConversation[] = [];

  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured && UUID_REGEX.test(userId)) {
      // 1. Kullanıcının sahip olduğu şirketleri öğrenelim
      const companyIds: string[] = [userId]; // Bazen company_id doğrudan user_id olarak kaydedilir
      try {
        const { data: comps } = await supabase
          .from('companies')
          .select('id')
          .eq('user_id', userId);
        if (comps && comps.length > 0) {
          comps.forEach((c) => {
            if (c.id && !companyIds.includes(c.id)) companyIds.push(c.id);
          });
        }
      } catch (cErr) {
        console.warn('[getConversations] Comp lookup error:', cErr);
      }

      // 2. Kullanıcının ilanlarının company_id'lerini de ekleyelim
      try {
        const { data: listings } = await supabase
          .from('listings')
          .select('company_id')
          .limit(50);
        // Eğer kullanıcı ilanın sahibiyse (veya company_id eşleşmesi varsa)
      } catch {}

      // 3. Konuşmaları çek: Kullanıcı alıcı (buyer_id) VEYA firma (company_id) olabilir
      const filterConditions = [
        `buyer_id.eq.${userId}`,
        ...companyIds.map((cId) => `company_id.eq.${cId}`),
      ].join(',');

      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          buyer:profiles(full_name),
          company:companies(name),
          listing:listings(title),
          messages:messages(content, created_at, is_read, sender_id)
        `)
        .or(filterConditions)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('[getConversations] Supabase query error:', error.message);
      }

      if (!error && data && data.length > 0) {
        results = data.map((d: any) => {
          const isUserBuyer = d.buyer_id === userId;
          const otherName = isUserBuyer
            ? d.company?.name || d.company_name || 'Firma Yetkilisi'
            : d.buyer?.full_name || d.buyer_name || 'Alıcı Müşteri';

          const msgs = d.messages || [];
          const sortedMsgs = [...msgs].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const lastMsg = sortedMsgs[sortedMsgs.length - 1];

          return {
            ...d,
            other_user_name: otherName,
            other_user_role: isUserBuyer ? 'company' : 'buyer',
            listing_title: d.listing?.title || d.listing_title,
            unread_count: msgs.filter((m: any) => !m.is_read && m.sender_id !== userId).length,
            last_message: lastMsg?.content || lastMsg?.body,
            last_message_at: lastMsg?.created_at || d.updated_at,
          };
        });
      }
    }
  } catch (err) {
    console.error('[getConversations] Unexpected fetch error:', err);
  }

  // Yerel saklama alanındaki konuşmalar ile birleştir (kullanıcının kendi konuşmaları)
  const stored = getStoredConversations().filter(
    (c) => c.buyer_id === userId || c.company_id === userId
  );

  for (const s of stored) {
    if (!results.some((r) => r.id === s.id)) {
      results.push(s);
    }
  }

  return results.sort(
    (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
  );
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  if (!conversationId) return [];

  let results: Message[] = [];

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

      if (!error && data && data.length > 0) {
        results = data.map((d: any) => ({
          ...d,
          body: d.content || d.body,
          content: d.content || d.body,
        })) as Message[];
      }
    }
  } catch (err) {
    console.warn('[getMessages] Supabase error:', err);
  }

  // Yerel mesajlar ile birleştir (duplicate önleyerek)
  const stored = getStoredMessages(conversationId);
  for (const s of stored) {
    if (!results.some((r) => r.id === s.id)) {
      results.push({
        ...s,
        body: s.content || s.body,
        content: s.content || s.body,
      });
    }
  }

  return results.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

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

  const supabase = createClient();
  const isSupabaseConfigured =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  let allowContact = false;

  // İki taraf arasında onaylanmış iletişim kartı veya onaylı anlaşma var mı kontrol et
  if (isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('buyer_id, company_id')
        .eq('id', conversationId)
        .maybeSingle();

      if (conv) {
        const { data: reveal } = await supabase
          .from('contact_reveals')
          .select('id')
          .eq('buyer_id', conv.buyer_id)
          .eq('company_id', conv.company_id)
          .maybeSingle();

        if (reveal) {
          allowContact = true;
        }
      }
    } catch {
      // sessizce devam et
    }
  }

  // Merkezi Güvenli İçerik Tarayıcısı
  const maskRes = sanitizeContent(body.trim(), { allowContact });
  const finalBody = maskRes.sanitizedText;
  let complianceLogId = `log-${Date.now()}`;

  // Eğer maskeleme yapıldıysa KVKK uyumlu log tut
  if (maskRes.isMasked && isSupabaseConfigured && UUID_REGEX.test(conversationId)) {
    try {
      const { data: logData } = await supabase
        .from('compliance_mask_logs')
        .insert({
          user_id: UUID_REGEX.test(senderId) ? senderId : null,
          entity_type: 'message',
          entity_id: conversationId,
          detected_types: maskRes.detectedTypes,
        })
        .select('id')
        .maybeSingle();

      if (logData?.id) {
        complianceLogId = logData.id;
      }
    } catch {
      // sessiz devam et
    }
  }

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

  // 1. Yerel saklama alanına kaydet
  const existingMsgs = getStoredMessages(conversationId);
  existingMsgs.push(newMsg);
  saveStoredMessages(conversationId, existingMsgs);

  // Konuşmanın son mesajını güncelle
  const convs = getStoredConversations();
  const targetConv = convs.find((c) => c.id === conversationId);
  if (targetConv) {
    targetConv.last_message = finalBody;
    targetConv.last_message_at = nowIso;
    targetConv.updated_at = nowIso;
    saveStoredConversations(convs);
  }

  // 2. Canlı Supabase'e gönder (Veritabanı kolon adı: content)
  try {
    if (isSupabaseConfigured && UUID_REGEX.test(conversationId) && UUID_REGEX.test(senderId)) {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          id: generatedId,
          conversation_id: conversationId,
          sender_id: senderId,
          content: finalBody,
          attachment_url: attachmentUrl || null,
          is_read: false,
        })
        .select()
        .single();

      if (!error && data) {
        await supabase
          .from('conversations')
          .update({ updated_at: nowIso, last_message_at: nowIso })
          .eq('id', conversationId);

        const returnedMsg: Message = {
          ...data,
          body: data.content || finalBody,
          content: data.content || finalBody,
        };

        return {
          success: true,
          message: returnedMsg,
          isMasked: maskRes.isMasked,
          detectedTypes: maskRes.detectedTypes,
          infoNotice: maskRes.infoNotice,
          logId: complianceLogId,
        };
      } else if (error) {
        console.error('[sendMessage] Supabase insert error:', error.code, error.message);
        return {
          success: false,
          error: `Mesaj veritabanına kaydedilemedi (${error.code || 'Yetki/Hata'}). Karşı tarafın mesajı alabilmesi için oturumun doğrulanması gerekir.`,
          message: newMsg,
        };
      }
    }
  } catch (err: any) {
    console.error('[sendMessage] Supabase connection error:', err?.message || err);
  }

  return {
    success: true,
    message: newMsg,
    isMasked: maskRes.isMasked,
    detectedTypes: maskRes.detectedTypes,
    infoNotice: maskRes.infoNotice,
    logId: complianceLogId,
  };
}

export async function startConversation({
  buyerId,
  companyId,
  listingId,
  quoteId,
  companyName,
  listingTitle,
  initialMessage,
}: {
  buyerId: string;
  companyId: string;
  listingId?: string;
  quoteId?: string;
  companyName?: string;
  listingTitle?: string;
  initialMessage?: string;
}): Promise<{ success: boolean; conversation?: DemoConversation; error?: string }> {
  if (!buyerId || !companyId) {
    return { success: false, error: 'Alıcı ve firma bilgileri gereklidir.' };
  }

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
  };

  // Supabase senkronizasyonu
  try {
    const supabase = createClient();
    const isSupabaseConfigured =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (isSupabaseConfigured && UUID_REGEX.test(buyerId) && UUID_REGEX.test(companyId)) {
      // Önce veritabanında mevcut konuşma var mı kontrol et
      let checkQuery = supabase
        .from('conversations')
        .select(`
          *,
          buyer:profiles(full_name),
          company:companies(name),
          listing:listings(title)
        `)
        .eq('buyer_id', buyerId)
        .eq('company_id', companyId);

      if (listingId && UUID_REGEX.test(listingId)) {
        checkQuery = checkQuery.eq('listing_id', listingId);
      }

      const { data: dbExisting } = await checkQuery.maybeSingle();

      if (dbExisting) {
        const mappedExisting: DemoConversation = {
          ...dbExisting,
          other_user_name: dbExisting.company?.name || companyName || 'Firma Yetkilisi',
          other_user_role: 'company',
          listing_title: dbExisting.listing?.title || listingTitle,
          unread_count: 0,
        };
        if (initialMessage) {
          await sendMessage(dbExisting.id, buyerId, initialMessage);
        }
        return { success: true, conversation: mappedExisting };
      }

      const insertPayload: any = {
        id: generatedConvId,
        buyer_id: buyerId,
        company_id: companyId,
        listing_id: (listingId && UUID_REGEX.test(listingId)) ? listingId : null,
        quote_request_id: (quoteId && UUID_REGEX.test(quoteId)) ? quoteId : null,
      };

      const { data: inserted, error: insErr } = await supabase
        .from('conversations')
        .insert(insertPayload)
        .select(`
          *,
          buyer:profiles(full_name),
          company:companies(name),
          listing:listings(title)
        `)
        .single();

      if (!insErr && inserted) {
        newConv.id = inserted.id;
        newConv.other_user_name = inserted.company?.name || companyName || 'Firma Yetkilisi';
        newConv.listing_title = inserted.listing?.title || listingTitle;
      } else if (insErr) {
        console.error('[startConversation] Supabase insert error:', insErr.code, insErr.message);
      }
    }
  } catch (err: any) {
    console.error('[startConversation] Supabase sync warning:', err?.message || err);
  }

  existingConvs.unshift(newConv);
  saveStoredConversations(existingConvs);

  if (initialMessage) {
    await sendMessage(newConv.id, buyerId, initialMessage);
  }

  return { success: true, conversation: newConv };
}

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
