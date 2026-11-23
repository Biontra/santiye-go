// ============================================================
// ŞantiyeGO – Saha Metraj & Malzeme Hesaplayıcı Utility
// ============================================================

// ─── SEKME 1: Hazır Beton ───────────────────────────────────

export type BetonSinifi = 'C25' | 'C30' | 'C35';

export interface BetonInput {
  alan: number;        // m²
  kalinlik: number;   // cm
  sinif: BetonSinifi;
}

export interface BetonResult {
  netM3: number;
  firePay: number;
  toplamM3: number;
  mikserSayisi: number;
  sinif: BetonSinifi;
}

export function calculateBeton(input: BetonInput): BetonResult {
  const kalinlikM = input.kalinlik / 100;
  const netM3 = input.alan * kalinlikM;
  const firePay = netM3 * 0.05;
  const toplamM3 = netM3 + firePay;
  const mikserSayisi = Math.ceil(toplamM3 / 9); // 1 transmikser = 9 m³
  return {
    netM3: +netM3.toFixed(2),
    firePay: +firePay.toFixed(2),
    toplamM3: +toplamM3.toFixed(2),
    mikserSayisi,
    sinif: input.sinif,
  };
}

/** Beton hesabını teklif formu için düz string açıklamaya çevirir */
export function betonToQuoteDescription(r: BetonResult, input: BetonInput): string {
  return (
    `Hazır Beton Talebi\n` +
    `• Beton Sınıfı: ${r.sinif}\n` +
    `• Döküm Alanı: ${input.alan} m²\n` +
    `• Plak/Döşeme Kalınlığı: ${input.kalinlik} cm\n` +
    `• Net Hacim: ${r.netM3} m³\n` +
    `• %5 Fire Payı Dahil Toplam: ${r.toplamM3} m³\n` +
    `• Tahmini Transmikser Sayısı: ${r.mikserSayisi} sefer (9 m³/sefer)\n\n` +
    `Hesaplayıcı tarafından otomatik oluşturuldu – ŞantiyeGO Metraj Aracı`
  );
}


// ─── SEKME 2: Demir Tonajı ───────────────────────────────────

export interface DevirInput {
  alan: number;   // m² – toplam inşaat alanı
  katSayisi: number;
}

export interface DevirResult {
  tahminiTonaj: number;
  aciklama: string;
}

// Türkiye inşaat sektörü standartı: ortalama 25–35 kg/m² per kat (konut)
// Hesaplamada 30 kg/m²/kat kullanıyoruz (orta değer)
const DEMIR_KG_PER_M2_PER_KAT = 30;

export function calculateDemir(input: DevirInput): DevirResult {
  const toplamM2 = input.alan * input.katSayisi;
  const kg = toplamM2 * DEMIR_KG_PER_M2_PER_KAT;
  const ton = kg / 1000;
  return {
    tahminiTonaj: +ton.toFixed(2),
    aciklama: `${input.alan} m² × ${input.katSayisi} kat × 30 kg/m² = ${kg.toFixed(0)} kg`,
  };
}

export function demirToQuoteDescription(r: DevirResult, input: DevirInput): string {
  return (
    `Nervürlü İnşaat Demiri Talebi\n` +
    `• Toplam İnşaat Alanı: ${input.alan} m²\n` +
    `• Kat Sayısı: ${input.katSayisi}\n` +
    `• Hesaplama Katsayısı: 30 kg/m²/kat (Orta Yoğunluk, Konut)\n` +
    `• Tahmini Tonaj: ${r.tahminiTonaj} ton\n\n` +
    `Hesaplayıcı tarafından otomatik oluşturuldu – ŞantiyeGO Metraj Aracı`
  );
}


// ─── SEKME 3: Duvar Malzemesi ────────────────────────────────

export type DuvarMalzeme = 'tugla' | 'bims' | 'gazbeton';

export interface DuvarInput {
  duvarAlani: number;   // m²
  boslukAlani: number;  // m² (kapı/pencere)
  malzeme: DuvarMalzeme;
}

export interface DuvarResult {
  netAlan: number;
  adet: number;
  harcTorba: number;
  malzemeAdi: string;
  birimBoyut: string;
}

const DUVAR_CONFIG: Record<DuvarMalzeme, {
  ad: string;
  birimM2PerAdet: number; // 1 adet kaç m² karşılıyor
  harcTorbaPerM2: number; // m² başına torba
  birim: string;
}> = {
  tugla: {
    ad: 'Delikli Tuğla (19×19×8.5 cm)',
    birimM2PerAdet: 0.0190, // ~52-53 adet/m²
    harcTorbaPerM2: 0.14,   // ~1 torba / 7 m²
    birim: '19×19×8.5 cm',
  },
  bims: {
    ad: 'Bims Blok (40×20×20 cm)',
    birimM2PerAdet: 0.08,  // 12.5 adet/m²
    harcTorbaPerM2: 0.10,  // ~1 torba / 10 m²
    birim: '40×20×20 cm',
  },
  gazbeton: {
    ad: 'Gazbeton / AAC Panel (60×20×25 cm)',
    birimM2PerAdet: 0.1266, // ~7.9 adet/m²
    harcTorbaPerM2: 0.07,   // ince derz yapıştırıcı ~1 torba / 14 m²
    birim: '60×20×25 cm',
  },
};

export function calculateDuvar(input: DuvarInput): DuvarResult {
  const cfg = DUVAR_CONFIG[input.malzeme];
  const netAlan = Math.max(0, input.duvarAlani - input.boslukAlani);
  const adet = Math.ceil(netAlan / cfg.birimM2PerAdet);
  const harcTorba = Math.ceil(netAlan * cfg.harcTorbaPerM2);
  return {
    netAlan: +netAlan.toFixed(2),
    adet,
    harcTorba,
    malzemeAdi: cfg.ad,
    birimBoyut: cfg.birim,
  };
}

export function duvarToQuoteDescription(r: DuvarResult, input: DuvarInput): string {
  return (
    `${r.malzemeAdi} Talebi\n` +
    `• Toplam Duvar Alanı: ${input.duvarAlani} m²\n` +
    `• Kapı/Pencere Boşlukları: ${input.boslukAlani} m²\n` +
    `• Net Duvar Alanı: ${r.netAlan} m²\n` +
    `• Birim Boyut: ${r.birimBoyut}\n` +
    `• Gereken Adet: ${r.adet.toLocaleString('tr-TR')} adet\n` +
    `• Tahmini Harç/Yapıştırıcı: ${r.harcTorba} torba\n\n` +
    `Hesaplayıcı tarafından otomatik oluşturuldu – ŞantiyeGO Metraj Aracı`
  );
}


// ─── SEKME 4: İskele & Mantolama ─────────────────────────────

export interface IskeleMantInput {
  cepheAlani: number; // m²
}

export interface IskeleMantResult {
  iskeleMkare: number;
  yalitimPaket: number;    // 60x100 cm, 6'lı paket ≈ 3.6 m²/paket
  boyaKova: number;        // 15 kg kova ≈ 4.5 m²/kat × 2 kat
  mantolameKmetre: number; // opsiyonel bilgi: fiber file (m)
}

const YALITIM_M2_PER_PAKET = 3.6;    // 60×100 levha, 6'lı
const BOYA_M2_PER_KOVA_KAT = 4.5;    // 15 kg kova, 1 kat
const BOYA_KAT_SAYISI = 2;

export function calculateIskeleMant(input: IskeleMantInput): IskeleMantResult {
  const iskeleMkare = input.cepheAlani * 1.1; // %10 güvenlik payı
  const yalitimPaket = Math.ceil(input.cepheAlani / YALITIM_M2_PER_PAKET);
  const toplamBoyaM2 = input.cepheAlani * BOYA_KAT_SAYISI;
  const boyaKova = Math.ceil(toplamBoyaM2 / BOYA_M2_PER_KOVA_KAT);
  const mantolameKmetre = Math.ceil(input.cepheAlani / 25); // fiber file rulo 25 m²
  return {
    iskeleMkare: +iskeleMkare.toFixed(1),
    yalitimPaket,
    boyaKova,
    mantolameKmetre,
  };
}

export function iskeleToQuoteDescription(r: IskeleMantResult, input: IskeleMantInput): string {
  return (
    `İskele & Dış Cephe Mantolama Talebi\n` +
    `• Brüt Cephe Alanı: ${input.cepheAlani} m²\n` +
    `• İskele Kurulum Alanı (%10 pay): ${r.iskeleMkare} m²\n` +
    `• Yalıtım Levhası Paketi (60×100 cm, 6'lı): ${r.yalitimPaket} paket\n` +
    `• Dış Cephe Boyası (15 kg, 2 kat): ${r.boyaKova} kova\n` +
    `• Fiber Taşıyıcı File: ${r.mantolameKmetre} rulo\n\n` +
    `Hesaplayıcı tarafından otomatik oluşturuldu – ŞantiyeGO Metraj Aracı`
  );
}
