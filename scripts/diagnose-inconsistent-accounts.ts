/**
 * ŞANTİYE GO – TUTARSIZ HESAP VE ROL TEŞHİS SCRİPTİ
 * (Veri silme YAPMAZ; super_admin ve buyer rolünde olup companies satırına sahip
 *  hesapları tespit eder ve raporlar)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'placeholder-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnoseInconsistentAccounts() {
  console.log('=== TUTARSIZ HESAP KONTROLÜ BAŞLATILIYOR ===');

  // 1. super_admin veya buyer olup companies kaydı olanlar
  const { data: profiles, error: profError } = await supabase
    .from('profiles')
    .select('id, role, full_name, created_at')
    .in('role', ['super_admin', 'buyer']);

  if (profError) {
    console.error('Profiller sorgulanırken hata:', profError);
    return;
  }

  const profileIds = (profiles || []).map((p) => p.id);
  const { data: companies, error: compError } = await supabase
    .from('companies')
    .select('id, user_id, name, created_at')
    .in('user_id', profileIds);

  if (compError) {
    console.error('Firmalar sorgulanırken hata:', compError);
    return;
  }

  const matched = (companies || []).map((c) => {
    const p = profiles?.find((prof) => prof.id === c.user_id);
    return {
      userId: c.user_id,
      companyId: c.id,
      companyName: c.name,
      userRole: p?.role,
      fullName: p?.full_name,
      created_at: c.created_at,
    };
  });

  console.log(`Toplam ${matched.length} tutarsız hesap tespit edildi:`);
  console.table(matched);

  console.log('\n--- RAPOR SONU ---');
  console.log('NOT: Kullanıcı onayı alınmadan hiçbir kayıt silinmemiştir.');
}

diagnoseInconsistentAccounts().catch(console.error);
