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
  ChevronDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Profile, Notification } from '@/types/database';
import { getActiveProfile, logoutUser } from '@/lib/services/auth-service';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/lib/services/notification-service';
import { getConversations } from '@/lib/services/message-service';

export default function Header() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(0);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    async function checkAuth() {
      try {
        const activeProfile = await getActiveProfile();
        if (activeProfile) {
          setProfile(activeProfile);
          const userNotifs = await getUserNotifications(activeProfile.id);
          setNotifications(userNotifs);

          // Okunmamış mesaj sayısını getir
          try {
            const convs = await getConversations(activeProfile.id);
            const totalUnread = convs.reduce((acc, c) => acc + (c.unread_count || 0), 0);
            setUnreadMessagesCount(totalUnread);
          } catch {}
        } else {
          setProfile(null);
          setNotifications([]);
          setUnreadMessagesCount(0);
        }
      } catch {
        setProfile(null);
        setNotifications([]);
        setUnreadMessagesCount(0);
      }
    }
    checkAuth();
  }, []);

  // Periyodik okunmamış mesaj ve bildirim sayacı senkronizasyonu (30 sn)
  useEffect(() => {
    if (!profile?.id) return;
    const interval = setInterval(async () => {
      try {
        const convs = await getConversations(profile.id);
        const totalUnread = convs.reduce((acc, c) => acc + (c.unread_count || 0), 0);
        setUnreadMessagesCount(totalUnread);
        const notifs = await getUserNotifications(profile.id);
        setNotifications(notifs);
      } catch {}
    }, 30000);
    return () => clearInterval(interval);
  }, [profile?.id]);

  const unreadNotifsCount = profile ? notifications.filter((n) => !n.is_read).length : 0;

  const handleNotifClick = () => {
    if (!profile) {
      router.push('/giris?redirect=/alici-paneli');
      return;
    }
    setNotifDropdownOpen(!notifDropdownOpen);
  };

  const handleMarkAllRead = async () => {
    if (profile?.id) {
      await markAllNotificationsAsRead(profile.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
  };

  const handleNotificationClick = async (notif: Notification) => {
    await markNotificationAsRead(notif.id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
    );
    setNotifDropdownOpen(false);
  };

  const handleSignOut = async () => {
    await logoutUser();
    setProfile(null);
    window.location.href = '/';
  };

  return (
    <header className="sticky top-0 z-50 bg-navy-900 border-b border-navy-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-6 h-16">
          {/* Logo & Brand */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="w-9 h-9 rounded-lg bg-orange-500 flex items-center justify-center text-white">
              <HardHat className="w-5 h-5" />
            </span>
            <span className="text-xl font-bold tracking-tight">
              Şantiye<span className="text-orange-500">GO</span>
            </span>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-200">
            <Link href="/ilanlar?category=is-makineleri" className="hover:text-white transition-colors">
              İş makineleri
            </Link>
            <Link href="/ilanlar?category=yapi-malzemeleri" className="hover:text-white transition-colors">
              Yapı malzemeleri
            </Link>
            <Link href="/ilanlar?category=nakliye" className="hover:text-white transition-colors">
              Nakliye
            </Link>
            <Link href="/teklif-iste" className="hover:text-white transition-colors">
              Teklif iste
            </Link>
            <div className="relative group">
              <button
                type="button"
                className="flex items-center gap-1 hover:text-white transition-colors"
                aria-haspopup="true"
              >
                Araçlar
                <ChevronDown className="w-4 h-4" />
              </button>
              <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity absolute left-0 top-full pt-2 z-50">
                <div className="w-56 bg-white text-navy-900 rounded-lg border border-slate-200 shadow-lg py-1 text-sm">
                  <Link href="/hesaplayici" className="block px-4 py-2 hover:bg-slate-50">Metraj hesaplayıcı</Link>
                  <Link href="/kesif-yukle" className="block px-4 py-2 hover:bg-slate-50">Keşif listesi yükle</Link>
                  <Link href="/operatorler" className="block px-4 py-2 hover:bg-slate-50">Operatör havuzu</Link>
                  <Link href="/santiyeden-santiyeye" className="block px-4 py-2 hover:bg-slate-50">Şantiyeden şantiyeye</Link>
                </div>
              </div>
            </div>
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
                <span className="absolute top-1 right-1 px-1.5 py-0.2 rounded-full bg-orange-500 text-white text-[11px] font-bold">
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
                  <span className="absolute top-1 right-1 px-1.5 py-0.2 rounded-full bg-orange-500 text-white text-[11px] font-bold">
                    {unreadNotifsCount}
                  </span>
                )}
              </button>

              {/* Notification Popover */}
              {profile && notifDropdownOpen && (
                <div className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden text-navy-900 z-50 animate-in fade-in zoom-in-95">
                  <div className="p-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-navy-900">
                      Bildirimler ({unreadNotifsCount} Yeni)
                    </span>
                    {unreadNotifsCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="text-[11px] font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1"
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
                          href={n.link_url || '#'}
                          onClick={() => handleNotificationClick(n)}
                          className={`block p-3 hover:bg-slate-50 transition text-xs ${
                            !n.is_read ? 'bg-orange-50/50' : ''
                          }`}
                        >
                          <div className="font-semibold text-navy-900 flex items-center justify-between">
                            <span>{n.title}</span>
                            <span className="text-[11px] text-slate-400 font-normal">
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
                  Giriş yap
                </Link>
                <Link
                  href="/kayit"
                  className="px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-navy-800 hover:bg-navy-700 text-white border border-slate-700 transition"
                >
                  Kayıt ol
                </Link>
              </div>
            )}

            {/* Post Ad Button */}
            <Link
              href={profile?.role === 'company' ? '/firma-paneli/yeni-ilan' : '/giris?redirect=/firma-paneli/yeni-ilan'}
              className="flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-orange-500 hover:bg-orange-600 text-white transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
              <span>İlan ver</span>
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
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white whitespace-nowrap"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              İlan ver
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
              Teklif iste
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
