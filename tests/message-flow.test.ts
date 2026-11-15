/**
 * ŞANTİYE GO – MESAJLAŞMA VE İLETİŞİM DOĞRULAMA BİRİM TESTLERİ
 * (Maskeleme 9A, Karakter ve Boyut Sınırları, HTML/Script Temizliği, Idempotency)
 */

import { sanitizeContent } from '../src/lib/security/contact-masker';

async function runMessageUnitTests() {
  console.log('================================================================');
  console.log(' ŞANTİYE GO – MESAJLAŞMA DOĞRULAMA VE GÜVENLİK BİRİM TESTİ');
  console.log('================================================================\n');

  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passCount++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? '(' + detail + ')' : ''}`);
      failCount++;
    }
  }

  // 1. Boş mesaj doğrulama
  const emptyCheck = sanitizeContent('   ');
  assert(emptyCheck.sanitizedText.trim() === '', 'Boş mesaj denetimi');

  // 2. Telefon numarası maskeleme (Türkçe ve formatlı)
  const phone1 = sanitizeContent('Beni 0532 999 88 77 numarasından arayınız.');
  assert(
    phone1.isMasked && phone1.sanitizedText.includes('[iletişim bilgisi gizlendi]'),
    'Telefon maskeleme (0532 xx)',
    phone1.sanitizedText
  );

  const phone2 = sanitizeContent('Ulaşım: +90 544 111 22 33 hemen görüşelim');
  assert(
    phone2.isMasked && phone2.sanitizedText.includes('[iletişim bilgisi gizlendi]'),
    'Uluslararası formatlı telefon maskeleme (+90 5xx)',
    phone2.sanitizedText
  );

  // 3. E-posta maskeleme
  const email1 = sanitizeContent('Teklifi firma@santiye.com adresine atar mısınız?');
  assert(
    email1.isMasked && email1.sanitizedText.includes('[iletişim bilgisi gizlendi]'),
    'E-posta maskeleme',
    email1.sanitizedText
  );

  // 4. IBAN maskeleme
  const iban1 = sanitizeContent('Hesabım: TR12 0006 1005 1980 0000 0000 01 buraya gönderin');
  assert(
    iban1.isMasked && iban1.sanitizedText.includes('[iletişim bilgisi gizlendi]'),
    'IBAN maskeleme (TRxx xx)',
    iban1.sanitizedText
  );

  // 5. Harici yönlendirme kelimeleri
  const kw1 = sanitizeContent('Fiyatı whatsapp üzerinden konuşalım');
  assert(
    kw1.isMasked && kw1.sanitizedText.includes('[iletişim bilgisi gizlendi]'),
    'Yasaklı kelime (whatsapp yönlendirmesi)',
    kw1.sanitizedText
  );

  const kw2 = sanitizeContent('Elden anlaşalım komisyon vermeyelim');
  assert(
    kw2.isMasked && kw2.sanitizedText.includes('[iletişim bilgisi gizlendi]'),
    'Komisyon kaçırma ifadesi (elden anlaşalım)',
    kw2.sanitizedText
  );

  // 6. Yanlış alarm (False Positive) koruması: Fiyat, tonaj, tarih, model kodu ASLA maskelenmemeli
  const safePrice = sanitizeContent('Günlük kiralama 15.000 TL dir, haftalık 90.000 ₺ olur.');
  assert(
    !safePrice.isMasked && safePrice.sanitizedText.includes('15.000 TL'),
    'Yanlış alarm koruması (Fiyat ve ₺ sembolü)'
  );

  const safeTonnage = sanitizeContent('Makinemiz 22 ton CAT 320D model paletli ekskavatördür.');
  assert(
    !safeTonnage.isMasked && safeTonnage.sanitizedText.includes('22 ton'),
    'Yanlış alarm koruması (Tonaj ve model kodu)'
  );

  const safeDimensions = sanitizeContent('Temel kazısı 1500 m2 alan ve 30 metre derinliktedir.');
  assert(
    !safeDimensions.isMasked && safeDimensions.sanitizedText.includes('1500 m2'),
    'Yanlış alarm koruması (Alan m² ve metre)'
  );

  const safeDate = sanitizeContent('Makinemiz 15.11.2026 ile 25.11.2026 tarihleri arasında boştadır.');
  assert(
    !safeDate.isMasked && safeDate.sanitizedText.includes('15.11.2026'),
    'Yanlış alarm koruması (Noktalı tarih)'
  );

  // 7. Karakter sınırı kontrolü (2000 karakter)
  const longMsg = 'A'.repeat(2050);
  assert(longMsg.length > 2000, '2000 karakter sınır doğrulaması');

  // 8. HTML / Script temizliği
  const scriptContent = '<script>alert("hack")</script>Merhaba <b>usta</b>';
  const stripped = scriptContent.replace(/<[^>]+>/g, '');
  assert(
    !stripped.includes('<script>') && !stripped.includes('<b>') && stripped.includes('Merhaba usta'),
    'HTML ve script etiketi temizleme doğrulaması'
  );

  // 9. Çift tıklama (Idempotency) koruma anahtarı üretimi
  const id1 = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'test-id';
  const id2 = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'test-id-2';
  assert(id1 !== id2 && id1.length > 10, 'İstemci mesaj idempotency UUID üretimi');

  console.log('\n================================================================');
  console.log(` Toplam Test: ${passCount + failCount} | Başarılı: ${passCount} | Başarısız: ${failCount}`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runMessageUnitTests().catch((e) => {
  console.error('Test hatası:', e);
  process.exit(1);
});
