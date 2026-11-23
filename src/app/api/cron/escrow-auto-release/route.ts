import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { cronCheckAutoReleaseEscrow } from '@/lib/services/escrow-service';

function safeEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest) {
  return handleCronExecution(req);
}

export async function POST(req: NextRequest) {
  return handleCronExecution(req);
}

async function handleCronExecution(req: NextRequest) {
  // CRON_SECRET Doğrulaması (Cron endpoint güvenliği)
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const customHeader = req.headers.get('x-cron-secret');

  // Gizli anahtar tanımlı değilse ÜRETİMDE istek reddedilir (fail-closed): aksi halde
  // uç nokta herkese açık olur ve herkes escrow serbest bırakmayı tetikleyebilirdi.
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[cron/escrow-auto-release] CRON_SECRET tanımlı değil; istek reddedildi.');
      return NextResponse.json({ error: 'Cron yapılandırması eksik.' }, { status: 503 });
    }
  } else {
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!safeEqual(bearerToken, cronSecret) && !safeEqual(customHeader, cronSecret)) {
      return NextResponse.json(
        { error: 'Yetkisiz erişim: Geçersiz veya eksik CRON_SECRET anahtarı.' },
        { status: 401 }
      );
    }
  }

  try {
    // 1. Veritabanı Tabanlı Hız Sınırlaması (Database-backed Rate Limiting)
    try {
      const supabase = createServiceRoleClient();
      const { data: rateCheck, error: rateErr } = await supabase.rpc(
        'execute_rate_limited_escrow_cron',
        { p_min_interval_seconds: 60 }
      );

      if (rateErr) {
        console.warn('execute_rate_limited_escrow_cron error, fallback to direct cron:', rateErr.message);
      } else if (rateCheck?.rate_limited) {
        return NextResponse.json(
          {
            rate_limited: true,
            message: rateCheck.message,
            retry_after_seconds: rateCheck.retry_after_seconds,
          },
          { status: 429 }
        );
      } else if (rateCheck?.success) {
        return NextResponse.json({
          success: true,
          executed_at: rateCheck.executed_at,
          result: rateCheck.cron_result,
        });
      }
    } catch {
      // If service role not configured or table missing, run direct service method
    }

    // 2. Direct fallback execution
    const res = await cronCheckAutoReleaseEscrow();
    return NextResponse.json({
      success: true,
      released_count: res.releasedCount || 0,
    });
  } catch (err: any) {
    console.error('[cron/escrow-auto-release] error:', err);
    // 3. Hata durumunda admin uyarısı oluştur
    try {
      const supabase = createServiceRoleClient();
      await supabase.from('admin_audit_logs').insert({
        action: 'cron_escrow_failure_alert',
        target_type: 'cron',
        target_id: 'auto_release',
        details: {
          error: err.message,
          failed_at: new Date().toISOString(),
        },
      });
    } catch {
      // Silent error handler
    }

    return NextResponse.json({ error: 'Zamanlanmış Escrow görevi yürütülemedi.' }, { status: 500 });
  }
}
