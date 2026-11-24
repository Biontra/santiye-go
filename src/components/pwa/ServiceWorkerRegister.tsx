'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service Worker kayıt hatası:', err);
      });
    };

    // React efekti çoğunlukla "load" olayından SONRA çalışır; o durumda olayı beklemek
    // service worker'ın hiç kaydolmamasına (ve push'un çalışmamasına) yol açar.
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
