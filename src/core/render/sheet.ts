// Contact sheets with numbered tiles, used to show emblems and drafts to vision-capable models.

import type { RgbaImage } from '../dds/dds.ts';
import { createImage, sampleBilinear } from './image.ts';

// 3x5 bitmap digits, one string of 15 bits per digit (row-major).
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
];

function drawNumber(img: RgbaImage, n: number, x0: number, y0: number, px: number) {
  const text = String(n);
  const w = (text.length * 4 - 1) * px + 2 * px;
  const h = 7 * px;
  for (let y = y0; y < y0 + h && y < img.height; y++)
    for (let x = x0; x < x0 + w && x < img.width; x++) img.data.set([0, 0, 0, 255], (y * img.width + x) * 4);
  [...text].forEach((ch, i) => {
    const bits = DIGITS[Number(ch)]!;
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++) {
        if (bits[r * 3 + c] !== '1') continue;
        for (let dy = 0; dy < px; dy++)
          for (let dx = 0; dx < px; dx++) {
            const x = x0 + px + (i * 4 + c) * px + dx;
            const y = y0 + px + r * px + dy;
            if (x < img.width && y < img.height) img.data.set([255, 255, 255, 255], (y * img.width + x) * 4);
          }
      }
  });
}

/** Lay out images in a grid of square tiles, each labelled with a number (labels[i] ?? i + 1). */
export function contactSheet(images: RgbaImage[], options: { tile?: number; columns?: number; labels?: number[] } = {}): RgbaImage {
  const tile = options.tile ?? 128;
  const cols = options.columns ?? Math.min(images.length, 6);
  const rows = Math.ceil(images.length / cols);
  const gap = 4;
  const sheet = createImage(cols * (tile + gap) + gap, rows * (tile + gap) + gap);
  sheet.data.fill(255);
  const px = new Float32Array(4);
  images.forEach((img, i) => {
    const ox = gap + (i % cols) * (tile + gap);
    const oy = gap + Math.floor(i / cols) * (tile + gap);
    for (let y = 0; y < tile; y++)
      for (let x = 0; x < tile; x++) {
        sampleBilinear(img, (x + 0.5) / tile, (y + 0.5) / tile, px);
        const o = ((oy + y) * sheet.width + ox + x) * 4;
        sheet.data[o] = px[0]! * 255;
        sheet.data[o + 1] = px[1]! * 255;
        sheet.data[o + 2] = px[2]! * 255;
        sheet.data[o + 3] = 255;
      }
    drawNumber(sheet, options.labels?.[i] ?? i + 1, ox, oy, Math.max(2, Math.round(tile / 40)));
  });
  return sheet;
}

/** Base64 for byte arrays, without Node's Buffer so it also runs in the browser. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
