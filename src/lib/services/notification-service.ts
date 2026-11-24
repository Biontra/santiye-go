import { createClient } from '@/lib/supabase/client';
import { Notification } from '@/types/database';

function mapRow(n: any): Notification {
  return {
    id: n.id,
    user_id: n.user_id,
    type: n.type,
    title: n.title,
    body: n.content || n.body,
    content: n.content,
    link_url: n.link_url,
    is_read: n.is_read,
    created_at: n.created_at,
  };
}

/**
 * Kullanıcının bildirimlerini canlı Supabase veritabanından çeker (yeniden eskiye).
 * RLS gereği yalnızca kendi bildirimleri döner.
 */
export async function getUserNotifications(
  userId: string,
  limit: number = 30,
  offset: number = 0
): Promise<Notification[]> {
  if (!userId) return [];

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('id, user_id, type, title, content, link_url, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + Math.max(1, limit) - 1);

    if (error) {
      console.warn('[getUserNotifications] Bildirimler çekilemedi:', error.message);
      return [];
    }

    return (data || []).map(mapRow);
  } catch (err: any) {
    console.warn('[getUserNotifications] Ağ hatası:', err.message);
    return [];
  }
}

/**
 * Bildirim tablosundaki değişiklikleri (yeni bildirim / okundu) canlı dinler.
 * Dönen fonksiyon aboneliği kapatır. Realtime kullanılamıyorsa sessizce devam eder;
 * çağıran taraf periyodik yenilemeyi yedek olarak tutmalıdır.
 */
export function subscribeToNotifications(userId: string, onChange: () => void): () => void {
  if (!userId) return () => {};
  try {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => onChange()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}

const CHANGED_EVENT = 'santiyego:notifications-changed';

/** Aynı sekmedeki bileşenlere (zil, /bildirimler) okundu bilgisini anında duyurur; realtime'a bağımlı kalmaz. */
function announceChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Bu sekmede bildirimler okundu işaretlenince çağrılır. Dönen fonksiyon dinlemeyi bırakır. */
export function onNotificationsChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGED_EVENT, callback);
  return () => window.removeEventListener(CHANGED_EVENT, callback);
}

/**
 * Kullanıcının okunmamış bildirim sayısını döner. Sorgu başarısız olursa null döner
 * (çağıran, önceki sayıyı koruyup rozeti yanlışlıkla sıfırlamasın diye).
 */
export async function getUnreadNotificationCount(userId: string): Promise<number | null> {
  if (!userId) return 0;

  try {
    const supabase = createClient();
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      return null;
    }
    return count || 0;
  } catch {
    return null;
  }
}

/**
 * Tek bir bildirimi okundu olarak işaretler.
 */
export async function markNotificationAsRead(id: string): Promise<void> {
  if (!id) return;

  try {
    const supabase = createClient();
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id);
    announceChange();
  } catch (err: any) {
    console.warn('[markNotificationAsRead] Hata:', err.message);
  }
}

/**
 * Kullanıcının tüm bildirimlerini okundu olarak işaretler.
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  if (!userId) return;

  try {
    const supabase = createClient();
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    announceChange();
  } catch (err: any) {
    console.warn('[markAllNotificationsAsRead] Hata:', err.message);
  }
}
