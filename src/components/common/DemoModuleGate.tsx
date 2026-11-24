import Link from 'next/link';
import type { ComponentType } from 'react';
import { isDemoFallbackAllowed } from '@/lib/config/runtime';

/**
 * Henüz gerçek veritabanına bağlanmamış (yalnızca demo verisiyle çalışan) modülleri
 * üretimde gizler. Böylece gerçek kullanıcılar sahte bakiye / ödeme / istatistik görmez
 * ve sahte "başarılı" işlem yapamaz. Demo / geliştirme modunda modül olduğu gibi açılır.
 */
export function withDemoModuleGate<P extends object>(
  Component: ComponentType<P>,
  options: { title: string; backHref: string; backLabel: string }
) {
  function GatedModule(props: P) {
    if (isDemoFallbackAllowed()) return <Component {...props} />;
    return (
      <div className="bg-slate-50 min-h-[60vh] flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm space-y-3">
          <span className="inline-block px-2.5 py-0.5 rounded bg-orange-100 text-orange-800 text-xs font-black">
            Yakında
          </span>
          <h1 className="text-xl font-black text-navy-900">{options.title}</h1>
          <p className="text-sm text-slate-500">
            Bu modül şu anda hazırlık aşamasındadır ve kısa süre içinde kullanıma açılacaktır.
          </p>
          <Link
            href={options.backHref}
            className="inline-block mt-2 text-sm font-bold text-orange-600 hover:underline"
          >
            ← {options.backLabel}
          </Link>
        </div>
      </div>
    );
  }
  GatedModule.displayName = `DemoModuleGate(${Component.displayName || Component.name || 'Module'})`;
  return GatedModule;
}
