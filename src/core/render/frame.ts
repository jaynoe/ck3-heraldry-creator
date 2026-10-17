// Shield shapes: in game, house arms are cut out with the mask of the culture's house frame
// (gfx/interface/coat_of_arms/frames/<frame>_mask.dds, the shape is in the alpha channel).

import type { Catalog } from '../catalog/catalog.ts';
import type { RgbaImage } from '../dds/dds.ts';

/** Most common frame among the given cultures' houses, so a new house in a region gets the usual shape. */
function commonFrame(catalog: Catalog, filter: (group: string) => boolean): string | undefined {
  const count = new Map<string, number>();
  for (const d of catalog.dynasties.values()) {
    if (!filter(d.group) || !d.culture) continue;
    const f = catalog.cultureFrames.get(d.culture);
    if (f) count.set(f, (count.get(f) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The house frame for a design: from the house itself (its culture), else from the parent house of a
 * cadet branch, else the most common one in the region, else the most common one in the playset.
 */
export function frameFor(catalog: Catalog, o: { house?: string; parent?: string; region?: string } = {}): string | undefined {
  for (const key of [o.house, o.parent]) {
    const culture = key ? catalog.dynasties.get(key)?.culture : undefined;
    const frame = culture && catalog.cultureFrames.get(culture);
    if (frame) return frame;
  }
  return (o.region && commonFrame(catalog, (g) => g === o.region)) || commonFrame(catalog, () => true);
}

export const frameMaskPath = (frame: string) => `gfx/interface/coat_of_arms/frames/${frame}_mask.dds`;

/**
 * Multiplies the image's alpha by the mask's alpha, scaled to the image (bilinear).
 * `outside` keeps that much opacity outside the shape (the editor shows the cut-off parts faintly).
 */
export function applyMask(img: RgbaImage, mask: RgbaImage, outside = 0): RgbaImage {
  const out = new Uint8ClampedArray(img.data);
  const sx = mask.width / img.width;
  const sy = mask.height / img.height;
  const at = (x: number, y: number) => mask.data[(Math.min(mask.height - 1, Math.max(0, y)) * mask.width + Math.min(mask.width - 1, Math.max(0, x))) * 4 + 3]!;
  for (let y = 0; y < img.height; y++) {
    const my = (y + 0.5) * sy - 0.5;
    const y0 = Math.floor(my);
    const fy = my - y0;
    for (let x = 0; x < img.width; x++) {
      const mx = (x + 0.5) * sx - 0.5;
      const x0 = Math.floor(mx);
      const fx = mx - x0;
      const a = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const k = outside + (1 - outside) * (a / 255);
      const i = (y * img.width + x) * 4 + 3;
      out[i] = Math.round(out[i]! * k);
    }
  }
  return { width: img.width, height: img.height, data: out };
}

export const frameArtPath = (frame: string) => `gfx/interface/coat_of_arms/frames/${frame}.dds`;

/**
 * The frame art is a strip of tiers side by side (AGOT: iron, bronze, copper, silver, gold, gold with
 * purple; in game the tier follows the dynasty's splendour). The app has no splendour, so it uses gold.
 */
export const FRAME_TIER = 4;

/** Draws one tier of the frame art over the image, scaled to it (bilinear, alpha "over"). */
export function applyFrame(img: RgbaImage, art: RgbaImage, tier = FRAME_TIER): RgbaImage {
  const size = art.height;
  const tiers = Math.max(1, Math.floor(art.width / size));
  const left = Math.min(tier, tiers - 1) * size;
  const out = new Uint8ClampedArray(img.data);
  const sx = size / img.width;
  const sy = size / img.height;
  const px = (x: number, y: number, c: number) =>
    art.data[(Math.min(size - 1, Math.max(0, y)) * art.width + left + Math.min(size - 1, Math.max(0, x))) * 4 + c]!;
  for (let y = 0; y < img.height; y++) {
    const my = (y + 0.5) * sy - 0.5;
    const y0 = Math.floor(my);
    const fy = my - y0;
    for (let x = 0; x < img.width; x++) {
      const mx = (x + 0.5) * sx - 0.5;
      const x0 = Math.floor(mx);
      const fx = mx - x0;
      const sample = (c: number) =>
        (px(x0, y0, c) * (1 - fx) + px(x0 + 1, y0, c) * fx) * (1 - fy) + (px(x0, y0 + 1, c) * (1 - fx) + px(x0 + 1, y0 + 1, c) * fx) * fy;
      const a = sample(3) / 255;
      if (a <= 0) continue;
      const i = (y * img.width + x) * 4;
      const below = out[i + 3]! / 255;
      const outA = a + below * (1 - a);
      for (let c = 0; c < 3; c++) out[i + c] = (sample(c) * a + out[i + c]! * below * (1 - a)) / outA;
      out[i + 3] = outA * 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Where the arms go inside a frame: the square that covers the frame's opening (the part of the
 * mask the frame art leaves free), as fractions of the frame. In game the arms are scaled into the
 * opening, so the frame hides only the edge; without this the frame would cover a quarter of them.
 */
export function frameOpening(mask: RgbaImage, art: RgbaImage, tier = FRAME_TIER): { x: number; y: number; size: number } {
  const size = art.height;
  const left = Math.min(tier, Math.max(1, Math.floor(art.width / size)) - 1) * size;
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const my = Math.floor((y * mask.height) / size);
      const mx = Math.floor((x * mask.width) / size);
      const inMask = mask.data[(my * mask.width + mx) * 4 + 3]! > 127;
      const open = art.data[(y * art.width + left + x) * 4 + 3]! < 64;
      if (inMask && open) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, size: 1 };
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  return { x: (cx - side / 2) / size, y: (cy - side / 2) / size, size: side / size };
}

/** A transparent `size`×`size` image with `img` drawn at (x, y). */
export function placeOn(img: RgbaImage, size: number, x: number, y: number): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < img.height; row++) {
    const ty = row + y;
    if (ty < 0 || ty >= size) continue;
    for (let col = 0; col < img.width; col++) {
      const tx = col + x;
      if (tx < 0 || tx >= size) continue;
      const s = (row * img.width + col) * 4;
      data.set(img.data.subarray(s, s + 4), (ty * size + tx) * 4);
    }
  }
  return { width: size, height: size, data };
}
