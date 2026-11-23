// ============================================================
// ŞantiyeGO – Bağımsız, Hafif SVG QR Kod Üretim Motoru
// Sıfır harici paket, %100 çevrimdışı (PWA) uyumlu, SVG çıktı
// ============================================================

/**
 * QR Kod Üreticisi (ISO/IEC 18004 Model 2, Byte modu, ECC seviyesi M).
 * Sürüm 1–9 (21x21 … 53x53) otomatik seçilir; en fazla 180 bayt (UTF-8) kodlanır.
 * Şantiyego dijital irsaliye URL'leri (~60-90 bayt) için Sürüm 5–7 yeterlidir.
 *
 * Standart uyumu: çok-bloklu Reed-Solomon + blok interleaving, tüm hizalama
 * desenleri, sürüm bilgisi (V7+), 8 maske + ceza puanı ile en iyi maske seçimi,
 * BCH(15,5) biçim bilgisi. Üretilen kodlar telefon kameralarıyla okunabilir.
 */

// ── GF(256) (primitive polynomial 0x11d) ─────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGalois() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = val;
    GF_LOG[val] = i;
    val <<= 1;
    if (val & 0x100) val ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

/** (x-α⁰)(x-α¹)…(x-α^(n-1)) — baştaki 1 katsayısı atlanmış, yüksek dereceden düşüğe. */
function rsGenerator(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// ── Sürüm tabloları (ECC seviyesi M) ─────────────────────────
interface VersionSpec {
  /** Toplam codeword sayısı */
  total: number;
  /** Blok başına ECC codeword */
  eccPerBlock: number;
  /** Blok sayısı */
  blocks: number;
  /** Alignment pattern merkez koordinatları */
  align: number[];
}

// index = version (1..9)
const VERSIONS: Record<number, VersionSpec> = {
  1: { total: 26, eccPerBlock: 10, blocks: 1, align: [] },
  2: { total: 44, eccPerBlock: 16, blocks: 1, align: [6, 18] },
  3: { total: 70, eccPerBlock: 26, blocks: 1, align: [6, 22] },
  4: { total: 100, eccPerBlock: 18, blocks: 2, align: [6, 26] },
  5: { total: 134, eccPerBlock: 24, blocks: 2, align: [6, 30] },
  6: { total: 172, eccPerBlock: 16, blocks: 4, align: [6, 34] },
  7: { total: 196, eccPerBlock: 18, blocks: 4, align: [6, 22, 38] },
  8: { total: 242, eccPerBlock: 22, blocks: 4, align: [6, 24, 42] },
  9: { total: 292, eccPerBlock: 22, blocks: 5, align: [6, 26, 46] },
};
const MAX_VERSION = 9;

function dataCodewords(v: number): number {
  const s = VERSIONS[v];
  return s.total - s.eccPerBlock * s.blocks;
}

/** Byte modu, sürüm 1–9: 4 bit mod + 8 bit uzunluk + veri. */
function byteCapacity(v: number): number {
  return Math.floor((dataCodewords(v) * 8 - 12) / 8);
}

export const QR_MAX_BYTES = byteCapacity(MAX_VERSION);

// ── Yardımcılar ──────────────────────────────────────────────
const getBit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function addEccAndInterleave(data: Uint8Array, v: number): Uint8Array {
  const { total, eccPerBlock, blocks } = VERSIONS[v];
  const numShort = blocks - (total % blocks);
  const shortLen = Math.floor(total / blocks) - eccPerBlock; // kısa bloktaki veri uzunluğu
  const divisor = rsGenerator(eccPerBlock);

  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let k = 0;
  for (let i = 0; i < blocks; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const d = data.subarray(k, k + len);
    k += len;
    dataBlocks.push(d);
    eccBlocks.push(rsRemainder(d, divisor));
  }

  const out: number[] = [];
  for (let i = 0; i <= shortLen; i++) {
    for (const d of dataBlocks) if (i < d.length) out.push(d[i]);
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (const e of eccBlocks) out.push(e[i]);
  }
  return Uint8Array.from(out);
}

function maskFn(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
  }
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;

  // N1: 5+ aynı renkli ardışık modül (satır & sütun)
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        const cur = pass === 0 ? m[a][b] : m[b][a];
        const prev = pass === 0 ? m[a][b - 1] : m[b - 1][a];
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
    }
  }

  // N2: 2x2 aynı renkli bloklar
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }

  // N3: 1:1:3:1:1 bulucu benzeri desen (4 açık modül ile)
  const p1 = [true, false, true, true, true, false, true, false, false, false, false];
  const p2 = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (get: (i: number) => boolean, pat: boolean[]) => {
    for (let i = 0; i < pat.length; i++) if (get(i) !== pat[i]) return false;
    return true;
  };
  for (let a = 0; a < n; a++) {
    for (let b = 0; b <= n - 11; b++) {
      if (matches((i) => m[a][b + i], p1) || matches((i) => m[a][b + i], p2)) score += 40;
      if (matches((i) => m[b + i][a], p1) || matches((i) => m[b + i][a], p2)) score += 40;
    }
  }

  // N4: koyu modül oranı
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * Metni QR matrisine çevirir. Dönen matris [satır][sütun], true = koyu modül.
 * Sığmayan (>180 bayt) metinlerde hata fırlatır.
 */
export function generateQRMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);

  // En küçük yeterli sürüm
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (bytes.length <= byteCapacity(v)) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new Error(`QR: metin çok uzun (${bytes.length} bayt, en fazla ${QR_MAX_BYTES}).`);
  }

  const size = version * 4 + 17;
  const capBits = dataCodewords(version) * 8;

  // ── Bit akışı ──
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data = new Uint8Array(capBits / 8);
  for (let i = 0; i < bits.length; i++) data[i >>> 3] |= bits[i] << (7 - (i & 7));

  const codewords = addEccAndInterleave(data, version);

  // ── Matris ──
  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFn: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFn[y][x] = true;
  };

  // Timing
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Finder + ayırıcı
  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // Alignment
  const pos = VERSIONS[version].align;
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  const drawFormat = (mask: number) => {
    const d = (0 << 3) | mask; // ECC M = 00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(f, i));
    setFn(8, 7, getBit(f, 6));
    setFn(8, 8, getBit(f, 7));
    setFn(7, 8, getBit(f, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(f, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(f, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(f, i));
    setFn(8, size - 8, true); // her zaman koyu modül
  };

  // Biçim alanını rezerve et, sürüm bilgisini çiz
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, getBit(v, i));
      setFn(b, a, getBit(v, i));
    }
  }

  // Veri bitlerini zigzag yerleştir
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && bitIdx < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bitIdx >>> 3], 7 - (bitIdx & 7));
          bitIdx++;
        }
      }
    }
  }

  // En düşük cezalı maskeyi seç
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFn[y][x] && maskFn(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const s = penalty(modules);
    if (s < bestScore) {
      bestScore = s;
      best = mask;
    }
    applyMask(mask); // geri al (XOR)
  }
  applyMask(best);
  drawFormat(best);

  return modules;
}

/**
 * QR matrisinden SVG <path d="..."> verisi üretir (4 modül sessiz bölge dahil).
 * viewBox boyutu: matrix.length + 8
 */
export function generateQRSvgPath(matrix: boolean[][]): string {
  let path = '';
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) {
        path += `M${c + 4},${r + 4}h1v1h-1z `;
      }
    }
  }
  return path;
}
