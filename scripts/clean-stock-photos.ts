/**
 * ŞANTİYE GO – İLANLARDAKİ STOK (UNSPLASH) GÖRSELLERİ TEMİZLEME SCRİPTİ
 * (Önce kuru çalıştırma - DRY RUN: hiçbir veriyi silmez, temizlenecekleri raporlar)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'placeholder-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanStockPhotos(dryRun = true) {
  console.log(`=== STOK GÖRSEL TEMİZLEME BAŞLATILIYOR (DRY RUN: ${dryRun}) ===`);

  const { data: listings, error } = await supabase
    .from('listings')
    .select('id, title, images')
    .not('images', 'is', null);

  if (error) {
    console.error('İlanlar alınırken hata:', error);
    return;
  }

  const affectedListings: Array<{ id: string; title: string; removedImages: string[]; remainingImages: string[] }> = [];

  for (const l of listings || []) {
    const rawImages: string[] = Array.isArray(l.images) ? l.images : [];
    const stockImages = rawImages.filter((img) => img.includes('unsplash.com') || img.includes('images.unsplash'));
    const cleanImages = rawImages.filter((img) => !img.includes('unsplash.com') && !img.includes('images.unsplash'));

    if (stockImages.length > 0) {
      affectedListings.push({
        id: l.id,
        title: l.title,
        removedImages: stockImages,
        remainingImages: cleanImages,
      });

      if (!dryRun) {
        await supabase
          .from('listings')
          .update({ images: cleanImages })
          .eq('id', l.id);
        console.log(`[TEMİZLENDİ] İlan: ${l.title} (${l.id}) - ${stockImages.length} stok görsel kaldırıldı.`);
      }
    }
  }

  console.log(`\nToplam ${affectedListings.length} ilanda Unsplash stok görseli tespit edildi.`);
  console.table(
    affectedListings.map((a) => ({
      id: a.id,
      title: a.title,
      kaldırılacakAdet: a.removedImages.length,
      kalanAdet: a.remainingImages.length,
    }))
  );

  if (dryRun) {
    console.log('\n[BİLGİ] Kuru çalıştırma tamamlandı. Gerçek çalıştırma için parametre olarak false veriniz.');
  }
}

const isLive = process.argv.includes('--execute');
cleanStockPhotos(!isLive).catch(console.error);
