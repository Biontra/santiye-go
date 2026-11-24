import { createClient } from '@/lib/supabase/client';
import { Review } from '@/types/database';
import { DEMO_BOOKINGS } from './booking-service';
import { DEMO_QUOTES } from './quote-service';
import { sanitizeContent } from '@/lib/security/contact-masker';
import { isDemoFallbackAllowed, isSupabaseConfigured } from '@/lib/config/runtime';

export interface VerifiedReviewWithUser extends Review {
  buyer_name: string;
}

// In-Memory store for offline/demo operation
export const DEMO_REVIEWS: VerifiedReviewWithUser[] = [
  {
    id: 'rev-001',
    company_id: 'f0000000-0000-0000-0000-000000000001',
    booking_id: 'book-0000-0000-0000-000000000001',
    listing_id: '10000000-0000-0000-0000-000000000001',
    buyer_id: 'buyer-demo-001',
    rating_overall: 4.8,
    rating_quality: 5,
    rating_timing: 4,
    rating_communication: 5,
    comment:
      'Tuzla şantiyemizdeki temel kazısı için kiraladık. CAT 320D ekskavatör tam vaktinde geldi. Operatör son derece tecrübeli ve İSG kurallarına tam uyumluydu. Teşekkürler.',
    company_reply:
      'Güzel yorumunuz için teşekkür ederiz Ahmet Bey. ŞantiyeGO üzerinden her zaman yanınızdayız.',
    company_reply_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    is_verified: true,
    is_demo: true,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    buyer_name: 'Ahmet Yılmaz (Müteahhit)',
  },
  {
    id: 'rev-002',
    company_id: 'f0000000-0000-0000-0000-000000000001',
    booking_id: null,
    listing_id: '10000000-0000-0000-0000-000000000002',
    buyer_id: 'buyer-demo-002',
    rating_overall: 4.7,
    rating_quality: 5,
    rating_timing: 5,
    rating_communication: 4,
    comment:
      'Mini ekskavatör dar alandaki drenaj işimizde çok iş gördü. Makine sıfır ayarındaydı, yakıt tüketimi oldukça ekonomikti.',
    company_reply: null,
    company_reply_at: null,
    is_verified: true,
    is_demo: true,
    created_at: new Date(Date.now() - 86400000 * 12).toISOString(),
    buyer_name: 'Mehmet Demir (Alt Taşeron)',
  },
];

export interface ReviewWithEscrowWeight extends Review {
  is_escrow_verified?: boolean;
  buyer_approved?: boolean; // True ONLY if explicit buyer approval was given (auto-release is false)
  verified_weight?: number;
  payment_status?: string;
  dispute_status?: string;
}

/**
 * Fetch dynamic escrow buyer approval multiplier from platform_settings table.
 * Defaults to 1.5 if table or setting is not configured.
 */
export async function getEscrowBuyerApprovalWeight(): Promise<number> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'escrow_buyer_approval_weight')
      .maybeSingle();

    if (data?.value) {
      const parsed = parseFloat(String(data.value));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // fallback to default
  }
  return 1.5;
}

/**
 * Prompt 9D + 9E Integration:
 * - Only platform-paid AND explicitly BUYER-APPROVED transactions count with the elevated confidence weight (buyerApprovalWeight from settings, e.g. 1.5x).
 * - Auto-released transactions (transferred without buyer approval upon timer expiration) are valid but receive standard 1.0x weight.
 * - Refunded or buyer-favored disputed jobs are strictly EXCLUDED from positive rating calculation.
 */
export function calculateEscrowWeightedTrust(
  reviews: ReviewWithEscrowWeight[],
  options?: { buyerApprovalWeight?: number }
): {
  bayesianScore: number | null;
  actualAvg: number | null;
  totalValidCount: number;
  escrowVerifiedCount: number;
  buyerApprovedCount: number;
  excludedDisputeCount: number;
} {
  const buyerApprovalWeight = options?.buyerApprovalWeight ?? 1.5;

  // 1. Exclude refunded and buyer-favored disputed jobs
  const validReviews = reviews.filter((r) => {
    if (r.payment_status === 'refunded' || r.dispute_status === 'resolved_buyer') {
      return false; // Excluded from company score
    }
    return true;
  });

  const excludedDisputeCount = reviews.length - validReviews.length;
  if (validReviews.length === 0) {
    return {
      bayesianScore: null,
      actualAvg: null,
      totalValidCount: 0,
      escrowVerifiedCount: 0,
      buyerApprovedCount: 0,
      excludedDisputeCount,
    };
  }

  let totalWeightedSum = 0;
  let totalEffectiveWeight = 0;
  let escrowVerifiedCount = 0;
  let buyerApprovedCount = 0;

  for (const r of validReviews) {
    // Elevate weight ONLY if explicitly buyer approved; auto-release without buyer approval receives standard 1.0
    let weight = r.verified_weight || 1.0;
    if (r.is_escrow_verified) {
      escrowVerifiedCount++;
      if (r.buyer_approved === true) {
        weight = buyerApprovalWeight;
        buyerApprovedCount++;
      } else {
        weight = 1.0; // Auto-release is not buyer approved
      }
    }
    totalWeightedSum += Number(r.rating_overall) * weight;
    totalEffectiveWeight += weight;
  }

  const R = totalWeightedSum / totalEffectiveWeight;
  const v = validReviews.length;
  const m = 3; // minimum threshold
  const C = 4.5; // platform prior benchmark

  const bayesianScore = (v / (v + m)) * R + (m / (v + m)) * C;

  return {
    bayesianScore: Number(bayesianScore.toFixed(2)),
    actualAvg: Number(R.toFixed(1)),
    totalValidCount: v,
    escrowVerifiedCount,
    buyerApprovedCount,
    excludedDisputeCount,
  };
}

export function calculateBayesianRating(
  reviews: Review[]
): { bayesianScore: number | null; actualAvg: number | null; totalCount: number } {
  const v = reviews.length;
  if (v === 0) {
    return { bayesianScore: null, actualAvg: null, totalCount: 0 };
  }

  const sum = reviews.reduce((acc, r) => acc + Number(r.rating_overall), 0);
  const R = sum / v;

  const m = 3; // minimum review threshold
  const C = 4.5; // platform prior average

  const bayesianScore = (v / (v + m)) * R + (m / (v + m)) * C;
  return {
    bayesianScore: Number(bayesianScore.toFixed(2)),
    actualAvg: Number(R.toFixed(1)),
    totalCount: v,
  };
}

function mapReviewRow(row: any): VerifiedReviewWithUser {
  const subs = [row.rating_quality, row.rating_timing, row.rating_communication].filter(
    (v: unknown) => typeof v === 'number'
  ) as number[];
  const overall = subs.length === 3 ? Number((subs.reduce((a, b) => a + b, 0) / 3).toFixed(1)) : row.rating;
  return {
    ...row,
    rating_overall: overall ?? row.rating,
    rating_quality: row.rating_quality ?? row.rating,
    rating_timing: row.rating_timing ?? row.rating,
    rating_communication: row.rating_communication ?? row.rating,
    company_reply_at: row.company_replied_at ?? row.company_reply_at ?? null,
    is_verified: true,
    buyer_name: row.buyer?.full_name || 'Doğrulanmış Alıcı',
  };
}

async function withReviewerNames(
  supabase: ReturnType<typeof createClient>,
  reviews: VerifiedReviewWithUser[]
): Promise<VerifiedReviewWithUser[]> {
  const ids = Array.from(new Set(reviews.map((r) => r.buyer_id).filter(Boolean)));
  if (ids.length === 0) return reviews;
  const { data } = await supabase.rpc('get_reviewer_names', { p_ids: ids });
  const names = new Map<string, string>((data || []).map((r: any) => [r.id, r.display_name]));
  return reviews.map((r) => ({ ...r, buyer_name: names.get(r.buyer_id) || r.buyer_name }));
}

/** Alıcının bu firmayla değerlendirilebilir (tamamlanmış, henüz puanlanmamış) rezervasyonunu bulur. */
async function findReviewableBooking(
  companyId: string,
  listingId?: string
): Promise<{ bookingId?: string; listingId?: string; buyerId?: string; reason?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { reason: 'Değerlendirme yapmak için giriş yapmalısınız.' };

  const today = new Date().toISOString().split('T')[0];
  let query = supabase
    .from('bookings')
    .select('id, listing_id, status, end_date')
    .eq('buyer_id', user.id)
    .eq('company_id', companyId)
    .or(`status.eq.completed,and(status.in.(approved,confirmed),end_date.lt.${today})`)
    .order('end_date', { ascending: false });
  if (listingId) query = query.eq('listing_id', listingId);

  const { data: bookings, error } = await query;
  if (error || !bookings || bookings.length === 0) {
    return {
      reason:
        'Yalnızca bu firma ile tamamlanmış bir rezervasyonu olan kullanıcılar doğrulanmış puanlama yapabilir.',
    };
  }

  const { data: existing } = await supabase
    .from('reviews')
    .select('booking_id')
    .in(
      'booking_id',
      bookings.map((b) => b.id)
    );
  const reviewed = new Set((existing || []).map((r) => r.booking_id));
  const candidate = bookings.find((b) => !reviewed.has(b.id));
  if (!candidate) return { reason: 'Bu firmayla tamamlanan rezervasyonlarınızı zaten değerlendirdiniz.' };
  return { bookingId: candidate.id, listingId: candidate.listing_id, buyerId: user.id };
}

export async function canUserReviewCompany(
  buyerId: string,
  companyId: string
): Promise<{ canReview: boolean; reason?: string }> {
  if (isSupabaseConfigured()) {
    const res = await findReviewableBooking(companyId);
    if (res.bookingId) return { canReview: true };
    if (!isDemoFallbackAllowed()) return { canReview: false, reason: res.reason };
  }

  const hasCompletedBooking = DEMO_BOOKINGS.some(
    (b) => b.buyer_id === buyerId && b.company_id === companyId && b.status === 'approved'
  );
  const hasAcceptedQuote = DEMO_QUOTES.some(
    (q) => q.company_id === companyId && q.status === 'accepted'
  );
  if (hasCompletedBooking || hasAcceptedQuote) return { canReview: true };

  return {
    canReview: false,
    reason:
      'Yalnızca bu firma ile tamamlanmış bir rezervasyonu veya kabul edilmiş teklifi olan kullanıcılar doğrulanmış puanlama yapabilir.',
  };
}

export async function getCompanyReviews(companyId: string): Promise<VerifiedReviewWithUser[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (!error && data) return withReviewerNames(supabase, data.map(mapReviewRow));
    } catch {
      // aşağıdaki karara düşer
    }
    if (!isDemoFallbackAllowed()) return [];
  }
  return DEMO_REVIEWS.filter((r) => r.company_id === companyId);
}

export async function getListingReviews(listingId: string): Promise<VerifiedReviewWithUser[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: false });
      if (!error && data) return withReviewerNames(supabase, data.map(mapReviewRow));
    } catch {
      // aşağıdaki karara düşer
    }
    if (!isDemoFallbackAllowed()) return [];
  }
  return DEMO_REVIEWS.filter((r) => r.listing_id === listingId);
}

export async function addReview(data: {
  company_id: string;
  listing_id?: string;
  booking_id?: string;
  buyer_id?: string;
  rating_quality: number;
  rating_timing: number;
  rating_communication: number;
  comment: string;
}): Promise<{ success: boolean; review?: Review; error?: string }> {
  const ratings = [data.rating_quality, data.rating_timing, data.rating_communication];
  if (ratings.some((r) => !Number.isInteger(r) || r < 1 || r > 5)) {
    return { success: false, error: 'Puanlar 1 ile 5 arasında olmalıdır.' };
  }
  const overall = Number((ratings.reduce((a, b) => a + b, 0) / 3).toFixed(1));
  const sanitizedComment = data.comment ? sanitizeContent(data.comment).maskedText : '';

  if (isSupabaseConfigured()) {
    const target = await findReviewableBooking(data.company_id, data.listing_id);
    if (target.bookingId && target.buyerId) {
      const supabase = createClient();
      const { data: row, error } = await supabase
        .from('reviews')
        .insert({
          booking_id: data.booking_id || target.bookingId,
          buyer_id: target.buyerId,
          company_id: data.company_id,
          listing_id: target.listingId || data.listing_id || null,
          rating: Math.round(overall),
          rating_quality: data.rating_quality,
          rating_timing: data.rating_timing,
          rating_communication: data.rating_communication,
          comment: sanitizedComment,
        })
        .select()
        .single();
      if (error || !row) {
        return { success: false, error: 'Değerlendirme kaydedilemedi. Lütfen tekrar deneyin.' };
      }
      return { success: true, review: mapReviewRow(row) };
    }
    if (!isDemoFallbackAllowed()) return { success: false, error: target.reason };
  }

  const check = await canUserReviewCompany(data.buyer_id || 'buyer-demo-001', data.company_id);
  if (!check.canReview) return { success: false, error: check.reason };

  const newReview: VerifiedReviewWithUser = {
    id: `rev-${Date.now()}`,
    company_id: data.company_id,
    listing_id: data.listing_id || null,
    booking_id: data.booking_id || null,
    buyer_id: data.buyer_id || 'buyer-demo-001',
    rating_overall: overall,
    rating_quality: data.rating_quality,
    rating_timing: data.rating_timing,
    rating_communication: data.rating_communication,
    comment: sanitizedComment,
    company_reply: null,
    company_reply_at: null,
    is_verified: true,
    is_demo: true,
    created_at: new Date().toISOString(),
    buyer_name: 'Ahmet Yılmaz (Müteahhit)',
  };
  DEMO_REVIEWS.unshift(newReview);
  return { success: true, review: newReview };
}

export async function addCompanyReply(
  reviewId: string,
  replyText: string
): Promise<{ success: boolean; error?: string }> {
  const sanitizedReply = replyText ? sanitizeContent(replyText).maskedText : '';
  if (!sanitizedReply.trim()) return { success: false, error: 'Yanıt boş olamaz.' };

  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('reviews')
      .update({ company_reply: sanitizedReply.slice(0, 2000) })
      .eq('id', reviewId)
      .is('company_reply', null)
      .select('id')
      .maybeSingle();
    if (!error && data) return { success: true };
    if (!isDemoFallbackAllowed()) {
      return { success: false, error: 'Yanıt kaydedilemedi (daha önce yanıtlanmış olabilir).' };
    }
  }

  const review = DEMO_REVIEWS.find((r) => r.id === reviewId);
  if (!review) return { success: false, error: 'Değerlendirme bulunamadı.' };
  if (review.company_reply) {
    return { success: false, error: 'Bu değerlendirmeye zaten bir yanıt verilmiş.' };
  }
  review.company_reply = sanitizedReply;
  review.company_reply_at = new Date().toISOString();
  return { success: true };
}

/**
 * -----------------------------------------------------------------------------
 * GÜVEN SİSTEMİ VE ALICI ONAYI METRİKLERİ (PROMPT 9D & 9E ENTEGRASYONU)
 * -----------------------------------------------------------------------------
 * Platform ödemeli ve alıcı onaylı iş "en güçlü kanıt" ağırlığıyla (2.0x) sayılır.
 * İade edilen veya alıcı lehine uyuşmazlıkla sonuçlanan işler skordan çıkarılır,
 * şikayet ve itiraz oranına dahil edilir.
 */
export function calculateCompanyTrustScore(params: {
  completedEscrowJobsCount: number; // Platform ödemeli ve alıcı onaylı
  standardJobsCount: number;        // Doğrudan ödemeli veya onaylı
  disputedLossCount: number;        // Alıcı lehine sonuçlanan itiraz / iade
  bayesianRating: number | null;    // 1 - 5 arası
}): {
  trustScore: number;
  badge: 'ELITE' | 'TRUSTED' | 'STANDARD' | 'WARNING';
  disputeRatePercent: number;
} {
  const { completedEscrowJobsCount, standardJobsCount, disputedLossCount, bayesianRating } = params;

  // Ağırlıklı tamamlanmış iş hacmi (Escrow: 2.0x, Standart: 1.0x)
  const weightedSuccess = (completedEscrowJobsCount * 2.0) + standardJobsCount;
  const totalAttempted = weightedSuccess + (disputedLossCount * 2.0);

  const disputeRatePercent = totalAttempted > 0
    ? Number(((disputedLossCount / (completedEscrowJobsCount + standardJobsCount + disputedLossCount)) * 100).toFixed(1))
    : 0.0;

  // Taban puan (100 üzerinden)
  const ratingFactor = bayesianRating ? (bayesianRating / 5.0) * 50 : 35; // max 50 puan
  const volumeFactor = Math.min(40, weightedSuccess * 5); // max 40 puan
  const disputePenalty = Math.min(50, disputedLossCount * 15); // itiraz cezası

  let trustScore = Math.max(0, Math.min(100, Math.round(ratingFactor + volumeFactor - disputePenalty + 10)));

  let badge: 'ELITE' | 'TRUSTED' | 'STANDARD' | 'WARNING' = 'STANDARD';
  if (disputeRatePercent > 10.0 || trustScore < 40) {
    badge = 'WARNING';
  } else if (trustScore >= 85 && completedEscrowJobsCount >= 3) {
    badge = 'ELITE';
  } else if (trustScore >= 70) {
    badge = 'TRUSTED';
  }

  return { trustScore, badge, disputeRatePercent };
}
