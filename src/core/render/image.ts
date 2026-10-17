import type { RgbaImage } from '../dds/dds.ts';

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Mip chain built by 2x2 box filtering; level 0 is the original. */
export function buildMips(img: RgbaImage): RgbaImage[] {
  const levels = [img];
  let cur = img;
  while (cur.width > 1 && cur.height > 1) {
    const w = cur.width >> 1;
    const h = cur.height >> 1;
    const next = createImage(w, h);
    const s = cur.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = ((y * 2) * cur.width + x * 2) * 4;
        const b = a + cur.width * 4;
        for (let c = 0; c < 4; c++) next.data[(y * w + x) * 4 + c] = (s[a + c]! + s[a + 4 + c]! + s[b + c]! + s[b + 4 + c]!) / 4;
      }
    }
    levels.push(next);
    cur = next;
  }
  return levels;
}

/**
 * Bilinear sample; u, v in [0,1]. Writes 0-1 floats into `out`.
 * `wrap` mirrors the game's emblem samplers (SampleMode "Wrap"): at a texture edge the opposite edge
 * bleeds in, which is what makes seams visible when an emblem with an opaque edge is moved inside the shield.
 */
export function sampleBilinear(img: RgbaImage, u: number, v: number, out: Float32Array, wrap = false): void {
  const w = img.width;
  const h = img.height;
  let x0: number, x1: number, y0: number, y1: number, fx: number, fy: number;
  if (wrap) {
    const x = u * w - 0.5;
    const y = v * h - 0.5;
    const fx0 = Math.floor(x);
    const fy0 = Math.floor(y);
    fx = x - fx0;
    fy = y - fy0;
    x0 = ((fx0 % w) + w) % w;
    y0 = ((fy0 % h) + h) % h;
    x1 = (x0 + 1) % w;
    y1 = (y0 + 1) % h;
  } else {
    const x = Math.min(Math.max(u * w - 0.5, 0), w - 1);
    const y = Math.min(Math.max(v * h - 0.5, 0), h - 1);
    x0 = Math.floor(x);
    y0 = Math.floor(y);
    x1 = Math.min(x0 + 1, w - 1);
    y1 = Math.min(y0 + 1, h - 1);
    fx = x - x0;
    fy = y - y0;
  }
  sampleAt(img, x0, x1, y0, y1, fx, fy, out);
}

function sampleAt(img: RgbaImage, x0: number, x1: number, y0: number, y1: number, fx: number, fy: number, out: Float32Array) {
  const d = img.data;
  const w = img.width;
  for (let c = 0; c < 4; c++) {
    const top = d[(y0 * w + x0) * 4 + c]! * (1 - fx) + d[(y0 * w + x1) * 4 + c]! * fx;
    const bot = d[(y1 * w + x0) * 4 + c]! * (1 - fx) + d[(y1 * w + x1) * 4 + c]! * fx;
    out[c] = (top * (1 - fy) + bot * fy) / 255;
  }
}

/**
 * Trilinear sampling like a GPU: choose two mip levels from the texel-to-pixel ratio and blend them.
 * This matters for seams: on the smaller level an edge pixel can already reach across the texture
 * border, which is where the game's wrap sampling produces visible lines.
 */
export class MipSampler {
  private l0: RgbaImage;
  private l1: RgbaImage;
  private t: number;
  private tmp = new Float32Array(4);

  constructor(mips: RgbaImage[], pixels: number) {
    const lod = Math.max(0, Math.log2(mips[0]!.width / Math.max(pixels, 1)));
    const base = Math.min(Math.floor(lod), mips.length - 1);
    this.l0 = mips[base]!;
    this.l1 = mips[Math.min(base + 1, mips.length - 1)]!;
    this.t = base + 1 < mips.length ? lod - base : 0;
  }

  sample(u: number, v: number, out: Float32Array, wrap: boolean): void {
    sampleBilinear(this.l0, u, v, out, wrap);
    if (this.t <= 0) return;
    sampleBilinear(this.l1, u, v, this.tmp, wrap);
    for (let c = 0; c < 4; c++) out[c] = out[c]! + (this.tmp[c]! - out[c]!) * this.t;
  }
}
