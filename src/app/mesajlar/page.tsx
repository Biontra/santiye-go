import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import MessagesClient from './MessagesClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface MessagesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  const cookieStore = await cookies();
  const hasAuthCookie =
    cookieStore.get('santiyego_auth')?.value === 'true' ||
    cookieStore.getAll().some((c) => c.name.includes('sb-') && c.name.includes('-auth-token'));

  // Sunucu tarafı zorunlu kimlik doğrulaması:
  // Giriş yapmamış kullanıcı mesajlar arayüzüne veya verilerine kesinlikle erişemez
  if (!hasAuthCookie) {
    const sp = await searchParams;
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(sp || {})) {
      if (typeof v === 'string') {
        query.set(k, v);
      }
    }
    const fullRedirect = query.toString() ? `/mesajlar?${query.toString()}` : '/mesajlar';
    redirect(`/giris?redirect=${encodeURIComponent(fullRedirect)}`);
  }

  return (
    <Suspense
      fallback={
        <div className="bg-slate-100 min-h-[calc(100vh-80px)] flex items-center justify-center p-8 text-xs text-slate-400">
          Mesajlaşma arayüzü yükleniyor...
        </div>
      }
    >
      <MessagesClient />
    </Suspense>
  );
}
