import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { adminRouteDecision } from '@/lib/security/admin-guard';

interface CookieToSet {
  name: string;
  value: string;
  options?: Parameters<typeof NextResponse.prototype.cookies.set>[2];
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  let user = null;
  let profileRole: string | null = null;

  if (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('placeholder')) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: CookieToSet[]) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            supabaseResponse = NextResponse.next({
              request,
            });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      });

      const { data } = await supabase.auth.getUser();
      user = data?.user || null;

      if (user && request.nextUrl.pathname.startsWith('/admin')) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        profileRole = profile?.role ?? null;
      }
    } catch {
      user = null;
    }
  }

  const url = request.nextUrl.clone();
  const path = url.pathname;

  // Security Headers Injection (permit iframe embedding in AI Studio preview)
  supabaseResponse.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org https://*.tile.openstreetmap.org; frame-ancestors *;"
  );
  supabaseResponse.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff');
  supabaseResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  supabaseResponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');

  const isAuthenticated = !!user;
  const userRole = user?.user_metadata?.role as string | undefined;

  // Protect admin routes
  if (path.startsWith('/admin')) {
    if (!isAuthenticated) {
      url.pathname = '/giris';
      url.searchParams.set('redirect', path);
      return NextResponse.redirect(url);
    }
    // Rol, kullanıcının değiştirebildiği user_metadata'dan değil veritabanındaki profilden okunur
    if (adminRouteDecision(true, profileRole) !== 'allow') {
      url.pathname = '/yetkisiz';
      return NextResponse.redirect(url);
    }
  }

  // Protect company routes
  if (path.startsWith('/firma-paneli')) {
    if (!isAuthenticated) {
      url.pathname = '/giris';
      url.searchParams.set('redirect', path);
      return NextResponse.redirect(url);
    }
    if (userRole === 'buyer') {
      url.pathname = '/alici-paneli';
      return NextResponse.redirect(url);
    }
  }

  // Protect buyer / profile routes
  if (path.startsWith('/alici-paneli')) {
    if (!isAuthenticated) {
      url.pathname = '/giris';
      url.searchParams.set('redirect', path);
      return NextResponse.redirect(url);
    }
    if (userRole === 'company') {
      url.pathname = '/firma-paneli';
      return NextResponse.redirect(url);
    }
  }

  // Protect messages route (preserving full URL query parameters)
  if (path.startsWith('/mesajlar')) {
    if (!isAuthenticated) {
      url.pathname = '/giris';
      const fullPath = request.nextUrl.pathname + request.nextUrl.search;
      url.searchParams.set('redirect', fullPath);
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
