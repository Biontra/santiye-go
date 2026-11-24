'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing, Loader2, Send, Smartphone } from 'lucide-react';
import {
  detectPushState,
  disablePush,
  enablePush,
  loadDeviceStatus,
  saveDevicePrefs,
  sendTestPush,
  type PushState,
} from '@/lib/push/client';
import { DEFAULT_PUSH_PREFS, type PushPrefs } from '@/lib/push/shared';

const PREF_LABELS: { key: keyof PushPrefs; label: string }[] = [
  { key: 'messages', label: 'Yeni mesajlar' },
  { key: 'quotes', label: 'Teklif talepleri, yeni teklifler ve Şantiyeden Şantiyeye talepleri' },
  { key: 'bookings', label: 'Rezervasyon, teslimat ve ilan onay işlemleri' },
];

/**
 * Bu cihaz için anlık (web push) bildirim anahtarı.
 * Bildirimler zaten sitedeki zil ikonunda görünür; bu bileşen tarayıcı kapalıyken de telefona/bilgisayara düşmesini sağlar.
 */
export default function PushNotificationManager() {
  const [state, setState] = useState<PushState>('checking');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const detected = await detectPushState();
    if (detected !== 'on') {
      setState(detected);
      return;
    }
    // Tarayıcıda abonelik var; bu hesap için sunucuda kayıtlı mı?
    const status = await loadDeviceStatus();
    if (status.status === 'login') {
      setNeedsLogin(true);
      setState('off');
    } else if (status.status === 'ok' && status.subscribed) {
      setPrefs(status.prefs);
      setState('on');
    } else {
      setState('off');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const turnOn = async () => {
    setBusy(true);
    setNotice(null);
    const result = await enablePush(prefs);
    setBusy(false);
    if (result.ok) {
      setNeedsLogin(false);
      setState('on');
      setNotice({ tone: 'ok', text: 'Bildirimler bu cihazda açıldı.' });
      return;
    }
    if (result.reason === 'login') {
      setNeedsLogin(true);
      return;
    }
    if (result.reason === 'denied') {
      setState(Notification.permission === 'denied' ? 'denied' : 'off');
      return;
    }
    setNotice({ tone: 'error', text: result.message || 'Bildirimler açılamadı. Lütfen tekrar deneyin.' });
  };

  const turnOff = async () => {
    setBusy(true);
    setNotice(null);
    await disablePush();
    setBusy(false);
    setState('off');
    setNotice({ tone: 'ok', text: 'Bu cihazda bildirimler kapatıldı.' });
  };

  const togglePref = async (key: keyof PushPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    const saved = await saveDevicePrefs({ [key]: next[key] });
    if (!saved) {
      setPrefs(prefs);
      setNotice({ tone: 'error', text: 'Tercih kaydedilemedi. Lütfen tekrar deneyin.' });
    }
  };

  const test = async () => {
    setBusy(true);
    const result = await sendTestPush();
    setBusy(false);
    setNotice({ tone: result.ok ? 'ok' : 'error', text: result.message });
  };

  const active = state === 'on';

  return (
    <section
      aria-label="Anlık bildirim ayarları"
      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
            {active ? <BellRing className="w-5 h-5 text-orange-500" /> : <Bell className="w-5 h-5 text-slate-400" />}
          </div>
          <div>
            <h3 className="font-extrabold text-navy-900 text-sm">Anlık Bildirimler</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {active
                ? 'Bu cihazda açık. Site kapalıyken de yeni mesaj, teklif ve rezervasyonlardan haberdar olursunuz.'
                : 'Yeni mesaj, teklif veya rezervasyon geldiğinde bu cihaza anında bildirim düşsün.'}
            </p>
          </div>
        </div>

        {state === 'off' && !needsLogin && (
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-xs transition shadow-md shadow-orange-500/20 shrink-0 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Bildirimleri Aç
          </button>
        )}
        {active && (
          <button
            type="button"
            onClick={turnOff}
            disabled={busy}
            className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-600 font-bold text-xs transition shrink-0"
          >
            Kapat
          </button>
        )}
      </div>

      {state === 'checking' && <div className="h-4 w-1/2 rounded bg-slate-100 animate-pulse" />}

      {needsLogin && (
        <p className="text-xs text-slate-600">
          Anlık bildirim almak için{' '}
          <Link href="/giris?redirect=/bildirimler" className="font-bold text-orange-600 hover:underline">
            giriş yapın
          </Link>
          .
        </p>
      )}

      {state === 'ios-install' && (
        <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 rounded-xl p-3">
          <Smartphone className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p>
            iPhone/iPad&apos;de anlık bildirim için önce siteyi Ana Ekrana ekleyin: Safari&apos;de <b>Paylaş</b> →{' '}
            <b>Ana Ekrana Ekle</b>. Ardından uygulamayı oradan açıp bu ayarı etkinleştirin. (iOS 16.4 veya üzeri gerekir.)
          </p>
        </div>
      )}

      {state === 'unsupported' && (
        <p className="text-xs text-slate-500">
          Bu tarayıcı anlık bildirimi desteklemiyor. Bildirimleriniz yine de sitedeki zil simgesinde görünür.
        </p>
      )}

      {state === 'unconfigured' && (
        <p className="text-xs text-slate-500">Anlık bildirimler şu anda kullanılamıyor. Zil simgesindeki bildirimler çalışmaya devam eder.</p>
      )}

      {state === 'denied' && (
        <p className="text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-xl p-3">
          Tarayıcınız bu site için bildirimleri engelliyor. Adres çubuğundaki kilit simgesine tıklayıp{' '}
          <b>Bildirimler</b> iznini &quot;İzin ver&quot; yaptıktan sonra sayfayı yenileyin.
        </p>
      )}

      {active && (
        <div className="pt-3 border-t border-slate-100 space-y-1">
          <span className="font-bold text-slate-700 text-xs block mb-1">Hangi bildirimleri alayım?</span>
          {PREF_LABELS.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700"
            >
              <span>{label}</span>
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={() => togglePref(key)}
                className="accent-orange-500 w-4 h-4 shrink-0"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={test}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-orange-600 hover:text-orange-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Test bildirimi gönder
          </button>
        </div>
      )}

      {notice && (
        <p
          role="status"
          className={`text-xs font-semibold ${notice.tone === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
