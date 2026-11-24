'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  HardHat,
  PlusCircle,
  User,
  Heart,
  Menu,
  X,
  Building2,
  Bell,
  MessageSquare,
  Send,
  CheckCheck,
  LogOut,
  Calculator,
  Recycle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Profile, Notification } from '@/types/database';
import { getActiveProfile, logoutUser } from '@/lib/services/auth-service';
import {
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  subscribeToNotifications,
  onNotificationsChanged,
} from '@/lib/services/notification-service';
import { disablePush } from '@/lib/push/client';
import { safeInternalPath } from '@/lib/push/shared';
import { getConversations } from '@/lib/services/message-service';

export default function Header() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(0);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    async function checkAuth() {
      try {
        const activeProfile = await getActiveProfile();
        if (activeProfile) {
          setProfile(activeProfile);
          const userNotifs = await getUserNotifications(activeProfile.id, 15);
          setNotifications(userNotifs);
          const initialUnread = await getUnreadNotificationCount(activeProfile.id);
          if (initialUnread !== null) setUnreadCount(initialUnread);

          // Okunmamış mesaj sayısını getir
          try {
            const convs = await getConversations(activeProfile.id);
            const totalUnread = convs.reduce((acc, c) => acc + (c.unread_count || 0), 0);
            setUnreadMessagesCount(totalUnread);
          } catch {}
        } else {
          setProfile(null);
          setNotifications([]);
          setUnreadCount(0);
          setUnreadMessagesCount(0);
        }
      } catch {
        setProfile(null);
        setNotifications([]);
        setUnreadCount(0);
        setUnreadMessagesCount(0);
      }
    }
    checkAuth();
  }, []);

  // Bildirim + mesaj sayaçlarını yenile
  useEffect(() => {
    if (!profile?.id) return;
    const userId = profile.id;
    let cancelled = false;

    // Üç kaynak birbirinden bağımsız: konuşmalar uç noktası hata verse bile bildirimler güncellenir
    const refresh = async () => {
      const [convs, notifs, unread] = await Promise.allSettled([
        getConversations(userId),
        getUserNotifications(userId, 15),
        getUnreadNotificationCount(userId),
      ]);
      if (cancelled) return;
      if (convs.status === 'fulfilled') {
        setUnreadMessagesCount(convs.value.reduce((acc, c) => acc + (c.unread_count || 0), 0));
      }
      if (notifs.status === 'fulfilled') setNotifications(notifs.value);
      if (unread.status === 'fulfilled' && unread.value !== null) setUnreadCount(unread.value);
    };

    // Canlı: yeni bildirim / okundu değişikliği anında yansır
    const unsubscribe = subscribeToNotifications(userId, refresh);
    // Aynı sekmede (örn. /bildirimler sayfasında) okundu yapılınca zil de hemen güncellensin
    const stopLocal = onNotificationsChanged(refresh);
    // Yedek: realtime kopsa bile 60 sn'de bir yenile; sekmeye dönünce hemen yenile
    const interval = setInterval(refresh, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      unsubscribe();
      stopLocal();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [profile?.id]);

  const unreadNotifsCount = profile ? unreadCount : 0;

  const handleNotifClick = () => {
    if (!profile) {
      router.push('/giris?redirect=/bildirimler');
      return;
    }
    setNotifDropdownOpen(!notifDropdownOpen);
  };

  const handleMarkAllRead = async () => {
    if (profile?.id) {
      await markAllNotificationsAsRead(profile.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    }
  };

  const handleNotificationClick = async (notif: Notification) => {
    await markNotificationAsRead(notif.id);
    if (!notif.is_read) setUnreadCount((c) => Math.max(0, c - 1));
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
    );
    setNotifDropdownOpen(false);
  };

  const handleSignOut = async () => {
    // Oturum kapanmadan önce bu cihazın push aboneliğini kaldır (en fazla 2,5 sn beklenir)
    await Promise.race([disablePush(), new Promise((resolve) => setTimeout(resolve, 2500))]);
    await logoutUser();
    setProfile(null);
    window.location.href = '/';
  };

  return (
    <header className="sticky top-0 z-50 bg-navy-900 border-b border-navy-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Logo & Brand */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20 group-hover:scale-105 transition-transform">
              <HardHat className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center text-xl sm:text-2xl font-black tracking-tight">
                <span>ŞANTİYE</span>
                <span className="ml-1 px-1.5 py-0.5 rounded bg-orange-500 text-white text-base sm:text-lg font-extrabold tracking-wider">
                  GO
                </span>
              </div>
              <p className="hidden sm:block text-[10px] text-slate-300 font-medium tracking-wide">
                Şantiyenizin akıllı çözüm ortağı
              </p>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-2.5 text-[13px] font-semibold text-slate-200">
            <Link
              href="/ilanlar?category=is-makineleri"
              className="hover:text-orange-500 transition-colors"
            >
              İş Makineleri
            </Link>
            <Link
              href="/ilanlar?category=yapi-malzemeleri"
              className="hover:text-orange-500 transition-colors"
            >
              Yapı Malzemeleri
            </Link>
            <Link
              href="/ilanlar?category=nakliye"
              className="hover:text-orange-500 transition-colors"
            >
              Nakliye
            </Link>
            <Link href="/operatorler" className="hover:text-orange-500 transition-colors">Operatör Havuzu</Link>
            <Link href="/kesif-yukle" className="hover:text-orange-500 transition-colors">Keşif / BOQ Yükle</Link>
            <Link
              href="/santiyeden-santiyeye"
              className="hover:text-orange-500 transition-colors flex items-center gap-1.5 leading-tight"
            >
              <Recycle className="w-3.5 h-3.5" />
              Şantiyeden Şantiyeye
            </Link>
            <Link
              href="/hesaplayici"
              className="hover:text-emerald-400 text-emerald-400 font-bold transition-colors flex items-center gap-1.5"
            >
              <Calculator className="w-3.5 h-3.5" />
              Hesaplayıcı
            </Link>
            <Link
              href="/teklif-iste"
              className="hover:text-orange-400 text-orange-400 font-bold transition-colors flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              Teklif İste
            </Link>
          </nav>

          {/* User & Action Buttons */}
          <div className="hidden md:flex items-center gap-2.5">
            {/* Messages Button */}
            <Link
              href={profile ? '/mesajlar' : '/giris?redirect=/mesajlar'}
              className="relative p-2 text-slate-300 hover:text-orange-500 transition-colors rounded-lg hover:bg-navy-800"
              title="Mesajlarım"
            >
              <MessageSquare className="w-5 h-5" />
              {unreadMessagesCount > 0 && (
                <span className="absolute top-1 right-1 px-1.5 py-0.2 rounded-full bg-orange-500 text-white text-[9px] font-black">
                  {unreadMessagesCount}
                </span>
              )}
            </Link>

            {/* Notification Bell Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={handleNotifClick}
                className="relative p-2 text-slate-300 hover:text-orange-500 transition-colors rounded-lg hover:bg-navy-800"
                title="Bildirimler"
              >
                <Bell className="w-5 h-5" />
                {unreadNotifsCount > 0 && (
                  <span className="absolute top-1 right-1 px-1.5 py-0.2 rounded-full bg-orange-500 text-white text-[9px] font-black">
                    {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
                  </span>
                )}
              </button>

              {/* Notification Popover */}
              {profile && notifDropdownOpen && (
                <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-navy-900 z-50 animate-in fade-in zoom-in-95">
                  <div className="p-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-navy-900">
                      Bildirimler ({unreadNotifsCount} Yeni)
                    </span>
                    {unreadNotifsCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="text-[10px] font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1"
                      >
                        <CheckCheck className="w-3 h-3" />
                        Tümünü Okundu Yap
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        Bildiriminiz bulunmuyor.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <Link
                          key={n.id}
                          href={safeInternalPath(n.link_url)}
                          onClick={() => handleNotificationClick(n)}
                          className={`block p-3 hover:bg-slate-50 transition text-xs ${
                            !n.is_read ? 'bg-orange-50/50' : ''
                          }`}
                        >
                          <div className="font-extrabold text-navy-900 flex items-center justify-between">
                            <span>{n.title}</span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              {new Date(n.created_at).toLocaleTimeString('tr-TR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                            {n.body}
                          </p>
                        </Link>
                      ))
                    )}
                  </div>
                  <Link
                    href="/bildirimler"
                    onClick={() => setNotifDropdownOpen(false)}
                    className="block p-2.5 text-center text-[11px] font-bold text-orange-600 hover:bg-slate-50 border-t border-slate-100"
                  >
                    Tüm bildirimleri gör
                  </Link>
                </div>
              )}
            </div>

            <Link
              href={profile ? '/favorilerim' : '/giris?redirect=/favorilerim'}
              className="p-2 text-slate-300 hover:text-orange-500 transition-colors rounded-lg hover:bg-navy-800"
              title="Favorilerim"
            >
              <Heart className="w-5 h-5" />
            </Link>

            {/* Role Navigations or Guest Buttons */}
            {profile ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/alici-paneli/taleplerim"
                  className="hidden xl:flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-navy-800 hover:bg-navy-700 text-slate-200 border border-slate-700 transition"
                >
                  Taleplerim
                </Link>

                {profile?.role === 'admin' || profile?.role === 'super_admin' ? (
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-orange-600 hover:bg-orange-700 text-white shadow-sm transition"
                  >
                    <HardHat className="w-4 h-4" />
                    Admin
                  </Link>
                ) : profile?.role === 'company' ? (
                  <Link
                    href="/firma-paneli"
                    className="flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-navy-800 hover:bg-navy-700 text-white border border-slate-700 transition"
                  >
                    <Building2 className="w-4 h-4 text-orange-500" />
                    Firma Paneli
                  </Link>
                ) : (
                  <Link
                    href="/alici-paneli"
                    className="flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-navy-800 hover:bg-navy-700 text-white border border-slate-700 transition"
                  >
                    <User className="w-4 h-4 text-orange-500" />
                    Hesabım
                  </Link>
                )}

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="p-2 text-slate-400 hover:text-red-400 rounded-lg hover:bg-navy-800 transition"
                  title="Güvenli Çıkış Yap"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/giris"
                  className="px-3.5 py-2 text-xs sm:text-sm font-bold text-slate-200 hover:text-white transition"
                >
                  Giriş Yap
                </Link>
                <Link
                  href="/kayit"
                  className="px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-navy-800 hover:bg-navy-700 text-white border border-slate-700 transition"
                >
                  Kayıt Ol
                </Link>
              </div>
            )}

            {/* Post Ad Button */}
            <Link
              href={profile?.role === 'company' ? '/firma-paneli/yeni-ilan' : '/giris?redirect=/firma-paneli/yeni-ilan'}
              className="flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-orange-500 hover:bg-orange-600 text-white shadow-md shadow-orange-500/25 transition active:scale-95"
            >
              <PlusCircle className="w-4 h-4" />
              <span>İlan Ver</span>
            </Link>
          </div>

          {/* Mobile Hamburger Button */}
          <div className="flex md:hidden items-center gap-2">
            <Link
              href={profile ? '/mesajlar' : '/giris?redirect=/mesajlar'}
              className="relative p-1.5 text-slate-300 hover:text-white"
            >
              <MessageSquare className="w-5 h-5" />
              {unreadMessagesCount > 0 && (
                <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-orange-500" />
              )}
            </Link>
            <Link
              href={profile?.role === 'company' ? '/firma-paneli/yeni-ilan' : '/firma-paneli'}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-orange-500 text-white"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              İlan Ver
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-navy-800 focus:outline-none"
              aria-label="Menü"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-navy-950 border-b border-navy-800 px-4 pt-3 pb-5 space-y-3">
          <div className="flex flex-col space-y-2 text-sm font-medium">
            <Link
              href="/teklif-iste"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-md bg-orange-500/20 text-orange-400 font-bold"
            >
              ⚡ Çoklu Teklif Talebi Oluştur
            </Link>
            <Link href="/operatorler" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2 rounded-md hover:bg-navy-800 text-slate-200">Operatör Havuzu</Link>
            <Link href="/kesif-yukle" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2 rounded-md hover:bg-navy-800 text-slate-200">Keşif / BOQ Yükle</Link>
            <Link
              href="/santiyeden-santiyeye"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-md hover:bg-navy-800 text-slate-200 flex items-center gap-1.5"
            >
              <Recycle className="w-3.5 h-3.5 text-orange-500" />
              Şantiyeden Şantiyeye
            </Link>
            <Link
              href="/hesaplayici"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-md bg-emerald-500/10 text-emerald-400 font-bold flex items-center gap-1.5"
            >
              <Calculator className="w-3.5 h-3.5" />
              Metraj Hesaplayıcı
            </Link>
            <Link
              href={profile ? '/alici-paneli/taleplerim' : '/giris?redirect=/alici-paneli/taleplerim'}
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-md hover:bg-navy-800 text-slate-200"
            >
              Teklif Taleplerim & Karşılaştırma
            </Link>
            <Link
              href={profile ? '/mesajlar' : '/giris?redirect=/mesajlar'}
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-md hover:bg-navy-800 text-slate-200"
            >
              Mesajlarım
            </Link>
            <Link
              href="/ilanlar?category=is-makineleri"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-md hover:bg-navy-800 text-slate-200"
            >
              İş Makineleri
            </Link>
            <Link
              href="/ilanlar?category=yapi-malzemeleri"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-md hover:bg-navy-800 text-slate-200"
            >
              Yapı Malzemeleri
            </Link>
            <Link
              href="/ilanlar?category=nakliye"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-md hover:bg-navy-800 text-slate-200"
            >
              Nakliye
            </Link>
          </div>

          <div className="pt-3 border-t border-navy-800 flex flex-col gap-2">
            <Link
              href={profile ? "/firma-paneli" : "/giris?redirect=/firma-paneli"}
              onClick={() => setMobileMenuOpen(false)}
              className="w-full text-center py-2.5 rounded-lg bg-navy-800 text-white font-semibold text-xs"
            >
              Firma Paneli (Talepler & Takvim)
            </Link>
            <Link
              href={profile ? "/alici-paneli" : "/giris?redirect=/alici-paneli"}
              onClick={() => setMobileMenuOpen(false)}
              className="w-full text-center py-2.5 rounded-lg bg-navy-800 text-white font-semibold text-xs"
            >
              Alıcı / Müteahhit Paneli
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
