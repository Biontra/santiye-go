// ============================================================
// ŞantiyeGO – Bağımsız, Hafif SVG QR Kod Üretim Motoru
// Sıfır harici paket, %100 çevrimdışı (PWA) uyumlu, SVG çıktı
// ============================================================

/**
 * Minimalist QR Kod Üreticisi (Model 2, Byte Modu, ECC Seviyesi M/L)
 * ŞantiyeGO dijital irsaliye QR kodları için URL ve token üretir.
 */

// GF(256) tablosu (primitive polynomial: 0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGalois() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = val;
    GF_LOG[val] = i;
    val = (val << 1) ^ (val & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

function rsCompute(data: Uint8Array, eccCount: number): Uint8Array {
  // Reed-Solomon jeneratör polinomu
  let gen = [1];
  for (let i = 0; i < eccCount; i++) {
    const nextGen = new Array(gen.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < gen.length; j++) {
      nextGen[j] ^= gfMul(gen[j], factor);
      nextGen[j + 1] ^= gen[j];
    }
    gen = nextGen;
  }

  const res = new Uint8Array(eccCount);
  for (let i = 0; i < data.length; i++) {
    const feedback = data[i] ^ res[0];
    for (let j = 0; j < eccCount - 1; j++) {
      res[j] = res[j + 1] ^ gfMul(gen[eccCount - 1 - j], feedback);
    }
    res[eccCount - 1] = gfMul(gen[0], feedback);
  }
  return res;
}

// Version 4-M (33x33 modules, 64 data bytes, 36 ECC bytes)
// Veya Version 3-L (29x29 modules, 55 data bytes)
// Şantiye teslimat tokenları (URL ~40-70 karakter) için Version 4 çok uygundur.
const QR_SIZE = 33;
const TOTAL_CODEWORDS = 100;
const DATA_CODEWORDS = 64;
const ECC_CODEWORDS = 36;

export function generateQRMatrix(text: string): boolean[][] {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);

  // Bit buffer oluştur
  const bits: number[] = [];
  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // Byte mode (0100) + 8-bit length
  pushBits(0b0100, 4);
  pushBits(textBytes.length, 8);
  for (let i = 0; i < textBytes.length; i++) {
    pushBits(textBytes[i], 8);
  }

  // Terminator
  pushBits(0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Padding
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < DATA_CODEWORDS * 8) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Baytlara çevir
  const data = new Uint8Array(DATA_CODEWORDS);
  for (let i = 0; i < DATA_CODEWORDS; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    data[i] = b;
  }

  // ECC Hesapla
  const ecc = rsCompute(data, ECC_CODEWORDS);

  const fullStream = new Uint8Array(TOTAL_CODEWORDS);
  fullStream.set(data, 0);
  fullStream.set(ecc, DATA_CODEWORDS);

  // 33x33 matris kur
  const matrix: (boolean | null)[][] = Array.from({ length: QR_SIZE }, () =>
    Array(QR_SIZE).fill(null)
  );

  // Fonksiyon modüllerini yerleştir
  function setSquare(r: number, c: number, size: number) {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        matrix[r + i][c + j] =
          i === 0 ||
          i === size - 1 ||
          j === 0 ||
          j === size - 1 ||
          (i >= 2 && i <= size - 3 && j >= 2 && j <= size - 3);
      }
    }
  }

  // 1. Finder patterns (7x7) + separators
  setSquare(0, 0, 7);
  setSquare(0, QR_SIZE - 7, 7);
  setSquare(QR_SIZE - 7, 0, 7);

  for (let i = 0; i < 8; i++) {
    if (matrix[7]?.[i] === null) matrix[7][i] = false;
    if (matrix[i]?.[7] === null) matrix[i][7] = false;
    if (matrix[7]?.[QR_SIZE - 1 - i] === null) matrix[7][QR_SIZE - 1 - i] = false;
    if (matrix[i]?.[QR_SIZE - 8] === null) matrix[i][QR_SIZE - 8] = false;
    if (matrix[QR_SIZE - 8]?.[i] === null) matrix[QR_SIZE - 8][i] = false;
    if (matrix[QR_SIZE - 1 - i]?.[7] === null) matrix[QR_SIZE - 1 - i][7] = false;
  }

  // 2. Alignment pattern at (24, 24) for Ver 4
  function setAlignment(r: number, c: number) {
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        matrix[r + i][c + j] =
          Math.max(Math.abs(i), Math.abs(j)) === 2 || (i === 0 && j === 0);
      }
    }
  }
  setAlignment(24, 24);

  // 3. Timing patterns
  for (let i = 8; i < QR_SIZE - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }

  // 4. Dark module
  matrix[QR_SIZE - 8][8] = true;

  // 5. Format info placeholder (reserve modules)
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][QR_SIZE - 1 - i] === null) matrix[8][QR_SIZE - 1 - i] = false;
    if (matrix[QR_SIZE - 1 - i][8] === null) matrix[QR_SIZE - 1 - i][8] = false;
  }

  // 6. Veri bitlerini zigzag yerleştir
  let bitIdx = 0;
  let upward = true;

  for (let right = QR_SIZE - 1; right > 0; right -= 2) {
    if (right === 6) right--; // timing col atla
    const rows = upward
      ? Array.from({ length: QR_SIZE }, (_, i) => QR_SIZE - 1 - i)
      : Array.from({ length: QR_SIZE }, (_, i) => i);

    for (const r of rows) {
      for (const c of [right, right - 1]) {
        if (matrix[r][c] === null) {
          const bytePos = Math.floor(bitIdx / 8);
          const bitPos = 7 - (bitIdx % 8);
          let bit = false;
          if (bytePos < fullStream.length) {
            bit = ((fullStream[bytePos] >> bitPos) & 1) === 1;
          }
          // Maske 0: (row + col) % 2 == 0
          if ((r + c) % 2 === 0) {
            bit = !bit;
          }
          matrix[r][c] = bit;
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }

  // 7. Format Information (Mask 0, ECC Level M: 101010000010010 XOR 101010000010010 = 0 -> 0x5412)
  const formatBits = 0x5412; // Standard masked format info for ECC M, mask 0
  const fArray = [];
  for (let i = 14; i >= 0; i--) {
    fArray.push(((formatBits >> i) & 1) === 1);
  }

  // Top-left format placement
  matrix[8][0] = fArray[0];
  matrix[8][1] = fArray[1];
  matrix[8][2] = fArray[2];
  matrix[8][3] = fArray[3];
  matrix[8][4] = fArray[4];
  matrix[8][5] = fArray[5];
  matrix[8][7] = fArray[6];
  matrix[8][8] = fArray[7];
  matrix[7][8] = fArray[8];
  matrix[5][8] = fArray[9];
  matrix[4][8] = fArray[10];
  matrix[3][8] = fArray[11];
  matrix[2][8] = fArray[12];
  matrix[1][8] = fArray[13];
  matrix[0][8] = fArray[14];

  // Bottom-left and Top-right format placement
  for (let i = 0; i < 7; i++) {
    matrix[QR_SIZE - 1 - i][8] = fArray[i];
  }
  for (let i = 0; i < 8; i++) {
    matrix[8][QR_SIZE - 8 + i] = fArray[7 + i];
  }

  return matrix.map((row) => row.map((cell) => cell ?? false));
}

/**
 * QR Kod Matrisinden doğrudan hafif SVG string veya bileşen üretir
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
