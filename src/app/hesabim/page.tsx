'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function HesabimRedirectPage() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function resolveRoute() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/giris?redirect=/hesabim');
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

        const role = profile?.role || user.user_metadata?.role || 'buyer';

        if (role === 'super_admin' || role === 'admin') {
          router.replace('/admin');
        } else if (role === 'company') {
          router.replace('/firma-paneli');
        } else {
          router.replace('/alici-paneli');
        }
      } catch (err) {
        console.error('Hesabım yönlendirme hatası:', err);
        router.replace('/giris');
      }
    }

    resolveRoute();
  }, [router]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-3">
      <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-bold text-slate-500">Hesabınıza yönlendiriliyorsunuz...</p>
    </div>
  );
}
