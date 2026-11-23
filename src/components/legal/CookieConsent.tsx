'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('sg_cookie_consent');
    if (!consent) {
      // Show after a gentle 1.5 second delay
      const timer = setTimeout(() => setShowBanner(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAcceptAll = () => {
    localStorage.setItem('sg_cookie_consent', 'all');
    setShowBanner(false);
  };

  const handleAcceptNecessary = () => {
    localStorage.setItem('sg_cookie_consent', 'necessary_only');
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 right-4 md:left-6 md:right-auto md:max-w-sm z-50">
      <div className="bg-white text-navy-900 rounded-lg p-4 border border-slate-300 shadow-lg space-y-3">
        <p className="text-sm text-slate-700 leading-relaxed">
          Sitenin çalışması ve anonim kullanım istatistikleri için çerez kullanıyoruz.{' '}
          <Link href="/gizlilik" className="underline hover:text-orange-600">Gizlilik ve çerez politikası</Link>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleAcceptNecessary}
            className="flex-1 py-2 px-3 rounded-lg border border-slate-300 hover:border-navy-900 text-navy-900 font-semibold text-sm transition-colors"
          >
            Yalnız zorunlu
          </button>
          <button
            type="button"
            onClick={handleAcceptAll}
            className="flex-1 py-2 px-3 rounded-lg bg-navy-900 hover:bg-navy-800 text-white font-semibold text-sm transition-colors"
          >
            Tümünü kabul et
          </button>
        </div>
      </div>
    </div>
  );
}
