import { createClient } from '@/lib/supabase/client';
import { Notification } from '@/types/database';

/**
 * Kullanıcının bildirimlerini canlı Supabase veritabanından çeker.
 */
export async function getUserNotifications(userId: string): Promise<Notification[]> {
  if (!userId) return [];

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.warn('[getUserNotifications] Bildirimler çekilemedi:', error.message);
      return [];
    }

    return (data || []).map((n: any) => ({
      id: n.id,
      user_id: n.user_id,
      type: n.type,
      title: n.title,
      body: n.content || n.body,
      content: n.content,
      link_url: n.link_url,
      is_read: n.is_read,
      created_at: n.created_at,
    }));
  } catch (err: any) {
    console.warn('[getUserNotifications] Ağ hatası:', err.message);
    return [];
  }
}

/**
 * Kullanıcının okunmamış bildirim sayısını döner.
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  if (!userId) return 0;

  try {
    const supabase = createClient();
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      return 0;
    }
    return count || 0;
  } catch {
    return 0;
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
  } catch (err: any) {
    console.warn('[markAllNotificationsAsRead] Hata:', err.message);
  }
}
