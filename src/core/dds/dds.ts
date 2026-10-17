// Minimal DDS decoder for the formats used by CK3 heraldry assets:
// BC1 (DXT1), BC2 (DXT3), BC3 (DXT5), BC7 and uncompressed 16/32-bit. Only the top mip level is decoded.

import { ANCHORS2, ANCHORS3, PARTITIONS2, PARTITIONS3 } from './bc7-tables.ts';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8ClampedArray;
}

export class DdsError extends Error {}

type Format = 'bc1' | 'bc2' | 'bc3' | 'bc7' | 'rgba8' | 'bgra8' | { masks: number[]; bits: number };

const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;

export function decodeDds(bytes: Uint8Array): RgbaImage {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 128 || dv.getUint32(0, true) !== 0x20534444) throw new DdsError('Not a DDS file');
  const height = dv.getUint32(12, true);
  const width = dv.getUint32(16, true);
  const pfFlags = dv.getUint32(80, true);
  const fourCC = String.fromCharCode(bytes[84]!, bytes[85]!, bytes[86]!, bytes[87]!);
  let offset = 128;
  let format: Format;

  if (pfFlags & DDPF_FOURCC) {
    if (fourCC === 'DXT1') format = 'bc1';
    else if (fourCC === 'DXT3') format = 'bc2';
    else if (fourCC === 'DXT5') format = 'bc3';
    else if (fourCC === 'DX10') {
      const dxgi = dv.getUint32(128, true);
      offset = 148;
      const map: Record<number, Format> = {
        71: 'bc1', 72: 'bc1', 74: 'bc2', 75: 'bc2', 77: 'bc3', 78: 'bc3',
        98: 'bc7', 99: 'bc7', 28: 'rgba8', 29: 'rgba8', 87: 'bgra8', 91: 'bgra8',
      };
      const f = map[dxgi];
      if (!f) throw new DdsError(`Unsupported DXGI format ${dxgi}`);
      format = f;
    } else throw new DdsError(`Unsupported FourCC ${fourCC}`);
  } else {
    const bits = dv.getUint32(88, true);
    const masks = [92, 96, 100, 104].map((o) => dv.getUint32(o, true));
    if (!(pfFlags & DDPF_ALPHAPIXELS)) masks[3] = 0;
    format = { masks, bits };
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const src = bytes.subarray(offset);
  if (format === 'rgba8' || format === 'bgra8') {
    const bgr = format === 'bgra8';
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = src[i * 4 + (bgr ? 2 : 0)]!;
      out[i * 4 + 1] = src[i * 4 + 1]!;
      out[i * 4 + 2] = src[i * 4 + (bgr ? 0 : 2)]!;
      out[i * 4 + 3] = src[i * 4 + 3]!;
    }
  } else if (typeof format === 'object') {
    decodeMasked(src, width, height, format.bits, format.masks, out);
  } else {
    decodeBlocks(src, width, height, format, out);
  }
  return { width, height, data: out };
}

function decodeMasked(src: Uint8Array, w: number, h: number, bits: number, masks: number[], out: Uint8ClampedArray) {
  const bpp = bits / 8;
  const shifts = masks.map((m) => (m ? Math.clz32(0) - Math.clz32(m & -m) - 1 : 0));
  const maxes = masks.map((m, i) => (m ? m >>> shifts[i]! : 0));
  for (let i = 0; i < w * h; i++) {
    let px = 0;
    for (let b = 0; b < bpp; b++) px |= src[i * bpp + b]! << (8 * b);
    px >>>= 0;
    for (let c = 0; c < 4; c++) {
      const m = masks[c]!;
      out[i * 4 + c] = m ? Math.round((((px & m) >>> shifts[c]!) / maxes[c]!) * 255) : c === 3 ? 255 : 0;
    }
  }
}

function decodeBlocks(src: Uint8Array, w: number, h: number, format: 'bc1' | 'bc2' | 'bc3' | 'bc7', out: Uint8ClampedArray) {
  const blockSize = format === 'bc1' ? 8 : 16;
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  if (src.length < bw * bh * blockSize) throw new DdsError('DDS data truncated');
  const block = new Uint8Array(64);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * blockSize;
      if (format === 'bc1') decodeColorBlock(src, o, block, true);
      else if (format === 'bc7') decodeBc7(src, o, block);
      else {
        decodeColorBlock(src, o + 8, block, false);
        if (format === 'bc2') decodeBc2Alpha(src, o, block);
        else decodeBc3Alpha(src, o, block);
      }
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= h) break;
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= w) break;
          const s = (py * 4 + px) * 4;
          const d = (y * w + x) * 4;
          out[d] = block[s]!;
          out[d + 1] = block[s + 1]!;
          out[d + 2] = block[s + 2]!;
          out[d + 3] = block[s + 3]!;
        }
      }
    }
  }
}

// Scratch palettes reused across blocks: decoding allocates nothing per block (this is the hot loop
// when browsing thousands of emblems).
const colorPal = new Uint8Array(16); // 4 entries × RGBA
const alphaPal = new Uint8Array(8);

function decodeColorBlock(src: Uint8Array, o: number, out: Uint8Array, bc1: boolean) {
  const c0 = src[o]! | (src[o + 1]! << 8);
  const c1 = src[o + 2]! | (src[o + 3]! << 8);
  // RGB565 → 8 bit by bit replication.
  const r0 = (((c0 >> 11) & 31) << 3) | (((c0 >> 11) & 31) >> 2);
  const g0 = (((c0 >> 5) & 63) << 2) | (((c0 >> 5) & 63) >> 4);
  const b0 = ((c0 & 31) << 3) | ((c0 & 31) >> 2);
  const r1 = (((c1 >> 11) & 31) << 3) | (((c1 >> 11) & 31) >> 2);
  const g1 = (((c1 >> 5) & 63) << 2) | (((c1 >> 5) & 63) >> 4);
  const b1 = ((c1 & 31) << 3) | ((c1 & 31) >> 2);
  const p = colorPal;
  p[0] = r0; p[1] = g0; p[2] = b0; p[3] = 255;
  p[4] = r1; p[5] = g1; p[6] = b1; p[7] = 255;
  if (!bc1 || c0 > c1) {
    p[8] = ((2 * r0 + r1) / 3) | 0; p[9] = ((2 * g0 + g1) / 3) | 0; p[10] = ((2 * b0 + b1) / 3) | 0; p[11] = 255;
    p[12] = ((r0 + 2 * r1) / 3) | 0; p[13] = ((g0 + 2 * g1) / 3) | 0; p[14] = ((b0 + 2 * b1) / 3) | 0; p[15] = 255;
  } else {
    p[8] = ((r0 + r1) / 2) | 0; p[9] = ((g0 + g1) / 2) | 0; p[10] = ((b0 + b1) / 2) | 0; p[11] = 255;
    p[12] = 0; p[13] = 0; p[14] = 0; p[15] = 0;
  }
  const idx = (src[o + 4]! | (src[o + 5]! << 8) | (src[o + 6]! << 16) | (src[o + 7]! << 24)) >>> 0;
  for (let i = 0; i < 16; i++) {
    const e = ((idx >>> (2 * i)) & 3) * 4;
    const d = i * 4;
    out[d] = p[e]!;
    out[d + 1] = p[e + 1]!;
    out[d + 2] = p[e + 2]!;
    out[d + 3] = p[e + 3]!;
  }
}

function decodeBc2Alpha(src: Uint8Array, o: number, out: Uint8Array) {
  for (let i = 0; i < 16; i++) {
    const nibble = (src[o + (i >> 1)]! >> ((i & 1) * 4)) & 15;
    out[i * 4 + 3] = nibble * 17;
  }
}

function decodeBc3Alpha(src: Uint8Array, o: number, out: Uint8Array) {
  const a0 = src[o]!;
  const a1 = src[o + 1]!;
  const pal = alphaPal;
  pal[0] = a0;
  pal[1] = a1;
  if (a0 > a1) for (let i = 1; i < 7; i++) pal[i + 1] = (((7 - i) * a0 + i * a1) / 7) | 0;
  else {
    for (let i = 1; i < 5; i++) pal[i + 1] = (((5 - i) * a0 + i * a1) / 5) | 0;
    pal[6] = 0;
    pal[7] = 255;
  }
  // 48 bits of 3-bit indices; split in two 24-bit halves to stay within 32-bit integer math.
  for (let half = 0; half < 2; half++) {
    const base = o + 2 + half * 3;
    const bits = src[base]! | (src[base + 1]! << 8) | (src[base + 2]! << 16);
    for (let i = 0; i < 8; i++) out[(half * 8 + i) * 4 + 3] = pal[(bits >> (3 * i)) & 7]!;
  }
}

// --- BC7 (ported from bcdec, see bc7-tables.ts) ---

const COLOR_BITS = [4, 6, 5, 7, 5, 7, 7, 5];
const ALPHA_BITS = [0, 0, 0, 0, 6, 8, 7, 5];
const MODE_HAS_PBITS = 0b11001011;
const WEIGHTS: Record<number, number[]> = {
  2: [0, 21, 43, 64],
  3: [0, 9, 18, 27, 37, 46, 55, 64],
  4: [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64],
};

const interp = (a: number, b: number, w: number[], i: number) => (a * (64 - w[i]!) + b * w[i]! + 32) >> 6;

function decodeBc7(src: Uint8Array, o: number, out: Uint8Array) {
  let bit = o * 8;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++, bit++) v |= ((src[bit >> 3]! >> (bit & 7)) & 1) << i;
    return v;
  };

  let mode = 0;
  while (mode < 8 && read(1) === 0) mode++;
  if (mode >= 8) {
    out.fill(0, 0, 64);
    return;
  }

  let partition = 0;
  let numPartitions = 1;
  let rotation = 0;
  let indexSelection = 0;
  if (mode === 0 || mode === 1 || mode === 2 || mode === 3 || mode === 7) {
    numPartitions = mode === 0 || mode === 2 ? 3 : 2;
    partition = read(mode === 0 ? 4 : 6);
  }
  const numEndpoints = numPartitions * 2;
  if (mode === 4 || mode === 5) {
    rotation = read(2);
    if (mode === 4) indexSelection = read(1);
  }

  const ep = Array.from({ length: numEndpoints }, () => [0, 0, 0, 0]);
  for (let c = 0; c < 3; c++) for (let e = 0; e < numEndpoints; e++) ep[e]![c] = read(COLOR_BITS[mode]!);
  if (ALPHA_BITS[mode]) for (let e = 0; e < numEndpoints; e++) ep[e]![3] = read(ALPHA_BITS[mode]!);

  const hasPBits = (MODE_HAS_PBITS >> mode) & 1;
  if (hasPBits) {
    for (const e of ep) for (let c = 0; c < 4; c++) e[c]! <<= 1;
    if (mode === 1) {
      const p0 = read(1);
      const p1 = read(1);
      for (let c = 0; c < 3; c++) {
        ep[0]![c]! |= p0;
        ep[1]![c]! |= p0;
        ep[2]![c]! |= p1;
        ep[3]![c]! |= p1;
      }
    } else {
      for (const e of ep) {
        const p = read(1);
        for (let c = 0; c < 4; c++) e[c]! |= p;
      }
    }
  }
  for (const e of ep) {
    const cb = COLOR_BITS[mode]! + hasPBits;
    for (let c = 0; c < 3; c++) {
      e[c] = e[c]! << (8 - cb);
      e[c] = e[c]! | (e[c]! >> cb);
    }
    const ab = ALPHA_BITS[mode]! + hasPBits;
    e[3] = e[3]! << (8 - ab);
    e[3] = e[3]! | (e[3]! >> ab);
    if (!ALPHA_BITS[mode]) e[3] = 255;
  }

  const indexBits = mode === 0 || mode === 1 ? 3 : mode === 6 ? 4 : 2;
  const indexBits2 = mode === 4 ? 3 : mode === 5 ? 2 : 0;
  const w1 = WEIGHTS[indexBits]!;
  const w2 = WEIGHTS[indexBits2 || 2]!;
  const table = numPartitions === 2 ? PARTITIONS2[partition]! : numPartitions === 3 ? PARTITIONS3[partition]! : null;
  const anchors = numPartitions === 2 ? ANCHORS2[partition]! : numPartitions === 3 ? ANCHORS3[partition]! : [0];
  const subsetOf = (i: number) => (table ? Number(table[i]) : 0);
  const isAnchor = (i: number) => anchors[subsetOf(i)] === i;

  const idx = new Array<number>(16);
  for (let i = 0; i < 16; i++) idx[i] = read(isAnchor(i) ? indexBits - 1 : indexBits);

  for (let i = 0; i < 16; i++) {
    const s = subsetOf(i);
    const e0 = ep[s * 2]!;
    const e1 = ep[s * 2 + 1]!;
    const index = idx[i]!;
    let r: number, g: number, b: number, a: number;
    if (!indexBits2) {
      r = interp(e0[0]!, e1[0]!, w1, index);
      g = interp(e0[1]!, e1[1]!, w1, index);
      b = interp(e0[2]!, e1[2]!, w1, index);
      a = interp(e0[3]!, e1[3]!, w1, index);
    } else {
      const index2 = read(i ? indexBits2 : indexBits2 - 1);
      const [ci, cw, ai, aw] = indexSelection ? [index2, w2, index, w1] : [index, w1, index2, w2];
      r = interp(e0[0]!, e1[0]!, cw, ci);
      g = interp(e0[1]!, e1[1]!, cw, ci);
      b = interp(e0[2]!, e1[2]!, cw, ci);
      a = interp(e0[3]!, e1[3]!, aw, ai);
    }
    if (rotation === 1) [a, r] = [r, a];
    else if (rotation === 2) [a, g] = [g, a];
    else if (rotation === 3) [a, b] = [b, a];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
}
