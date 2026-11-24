import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import NotificationsClient from './NotificationsClient';

export const metadata: Metadata = {
  title: 'Bildirimler | ŞANTİYE GO',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const cookieStore = await cookies();
  const hasAuthCookie =
    cookieStore.get('santiyego_auth')?.value === 'true' ||
    cookieStore.getAll().some((c) => c.name.includes('sb-') && c.name.includes('-auth-token'));

  // Giriş yapmamış kullanıcı bildirim arayüzünü görmez
  if (!hasAuthCookie) {
    redirect(`/giris?redirect=${encodeURIComponent('/bildirimler')}`);
  }

  return <NotificationsClient />;
}
