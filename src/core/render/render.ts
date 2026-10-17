// Software renderer that reproduces CK3's CoA shaders
// (jomini/gfx/FX/coat_of_arms/*.fxh) on plain RGBA buffers, so it runs in Node and the browser.

import { resolveColor, type Rgb } from '../coa/colors.ts';
import type { CoatOfArms, ColorValue, EmblemInstance } from '../coa/model.ts';
import type { AssetKind } from '../catalog/catalog.ts';
import type { RgbaImage } from '../dds/dds.ts';
import { createImage, MipSampler, sampleBilinear } from './image.ts';

export interface RenderContext {
  /** Mip chain of an asset texture, or undefined if it is missing. */
  getTexture(kind: AssetKind, name: string): Promise<RgbaImage[] | undefined>;
  /** CoA definitions for `parent` and `sub` references. */
  getCoa(key: string): CoatOfArms | undefined;
  namedColors: ReadonlyMap<string, ColorValue>;
  /** `coa_mask_texture.dds`; when set, the in-game cloth shading is applied. */
  shading?: RgbaImage;
}

export interface RenderResult {
  image: RgbaImage;
  /** Problems such as missing textures or unknown colour names. */
  warnings: string[];
}

const FALLBACK: Rgb = [128, 128, 128];
const EMBLEM_DEFAULT_COLOR: ColorValue = { kind: 'named', name: 'red' };

/** Overlay blend as in clausewitz `Overlay(Base, Blend)`; all values 0-1. */
const overlay = (base: number, blend: number) => (base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend));
/** `GetOverlay(Color, OverlayColor, Percent)` = lerp(Color, Overlay(OverlayColor, Color), Percent). */
const getOverlay = (color: number, ov: number, pct: number) => color + (overlay(ov, color) - color) * pct;

/** Apply `parent` inheritance: the child's pattern/colours override, emblems are appended. */
export function resolveInheritance(coa: CoatOfArms, getCoa: (k: string) => CoatOfArms | undefined, depth = 0): CoatOfArms {
  if (!coa.parent || depth > 8) return coa;
  const parentDef = getCoa(coa.parent);
  if (!parentDef) return coa;
  const parent = resolveInheritance(parentDef, getCoa, depth + 1);
  const colors = [...parent.colors];
  coa.colors.forEach((c, i) => c && (colors[i] = c));
  return {
    pattern: coa.pattern ?? parent.pattern,
    colors,
    coloredEmblems: [...parent.coloredEmblems, ...coa.coloredEmblems],
    texturedEmblems: [...parent.texturedEmblems, ...coa.texturedEmblems],
    subs: [...parent.subs, ...coa.subs],
  };
}

interface DrawItem {
  kind: 'colored_emblem' | 'textured_emblem';
  texture: string;
  colors?: Rgb[];
  mask?: number[];
  instance: EmblemInstance;
  depth: number;
  order: number;
}

export async function renderCoa(input: CoatOfArms, ctx: RenderContext, size = 256): Promise<RenderResult> {
  const warnings: string[] = [];
  const image = await renderInto(input, ctx, size, warnings, 0);
  return { image, warnings: [...new Set(warnings)] };
}

async function renderInto(input: CoatOfArms, ctx: RenderContext, size: number, warnings: string[], level: number): Promise<RgbaImage> {
  const coa = resolveInheritance(input, (k) => ctx.getCoa(k));
  const color = (c: ColorValue | undefined, slots: (Rgb | undefined)[], what: string): Rgb => {
    const rgb = resolveColor(c, { named: ctx.namedColors, slots });
    if (!rgb && c) warnings.push(`Unresolved colour ${JSON.stringify(c)} (${what})`);
    return rgb ?? FALLBACK;
  };
  const slots: (Rgb | undefined)[] = [];
  for (let i = 0; i < 5; i++) slots[i] = coa.colors[i] ? color(coa.colors[i], slots, `color${i + 1}`) : undefined;
  const coaColor = (i: number) => slots[i] ?? FALLBACK;

  const img = createImage(size, size);
  const buf = new Float32Array(size * size * 3);
  const px = new Float32Array(4);

  // Pattern
  const patternName = coa.pattern ?? 'pattern_solid.dds';
  const patternMips = await ctx.getTexture('pattern', patternName);
  if (!patternMips) warnings.push(`Missing pattern ${patternName}`);
  const pattern = patternMips?.[0];
  const [c1, c2, c3] = [coaColor(0), coaColor(1), coaColor(2)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pattern) sampleBilinear(pattern, (x + 0.5) / size, (y + 0.5) / size, px);
      else px.set([1, 0, 0, 1]);
      const o = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) {
        let v = FALLBACK[c]! / 255;
        v += (c1[c]! / 255 - v) * px[0]!;
        v += (c2[c]! / 255 - v) * px[1]!;
        v += (c3[c]! / 255 - v) * px[2]!;
        buf[o + c] = v;
      }
    }
  }

  // Emblems: higher depth is drawn further back; ties keep definition order.
  const items: DrawItem[] = [];
  let order = 0;
  for (const e of coa.texturedEmblems)
    for (const instance of e.instances)
      items.push({ kind: 'textured_emblem', texture: e.texture, mask: e.mask, instance, depth: instance.depth ?? 0, order: order++ });
  for (const e of coa.coloredEmblems) {
    // Missing emblem colours fall back to the named colour "red", not to the CoA's colours (verified in game).
    const colors = [0, 1, 2].map((i) => color(e.colors[i] ?? EMBLEM_DEFAULT_COLOR, slots, `${e.texture} color${i + 1}`));
    for (const instance of e.instances)
      items.push({ kind: 'colored_emblem', texture: e.texture, colors, mask: e.mask, instance, depth: instance.depth ?? 0, order: order++ });
  }
  items.sort((a, b) => b.depth - a.depth || a.order - b.order);

  for (const item of items) {
    const mips = await ctx.getTexture(item.kind, item.texture);
    if (!mips) {
      warnings.push(`Missing ${item.kind} ${item.texture}`);
      continue;
    }
    drawEmblem(buf, size, item, mips, pattern);
  }

  // Sub-CoAs: rendered separately, then placed at offset (top-left) with scale.
  for (const sub of coa.subs) {
    const subCoa = sub.coa ?? (sub.parent ? ctx.getCoa(sub.parent) : undefined);
    if (!subCoa || level > 4) {
      warnings.push(`Missing sub CoA ${sub.parent ?? '(inline)'}`);
      continue;
    }
    const subImg = await renderInto(subCoa, ctx, size, warnings, level + 1);
    for (const inst of sub.instances) {
      const [ox, oy] = inst.offset ?? [0, 0];
      const [sx, sy] = inst.scale ?? [1, 1];
      const x0 = Math.max(0, Math.floor(ox * size));
      const x1 = Math.min(size, Math.ceil((ox + sx) * size));
      const y0 = Math.max(0, Math.floor(oy * size));
      const y1 = Math.min(size, Math.ceil((oy + sy) * size));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sampleBilinear(subImg, ((x + 0.5) / size - ox) / sx, ((y + 0.5) / size - oy) / sy, px);
          const o = (y * size + x) * 3;
          for (let c = 0; c < 3; c++) buf[o + c] = px[c]!;
        }
      }
    }
  }

  // Optional cloth shading from coa_mask_texture.dds (blue channel, 20 % overlay).
  if (ctx.shading && level === 0) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        sampleBilinear(ctx.shading, (x + 0.5) / size, (y + 0.5) / size, px);
        const o = (y * size + x) * 3;
        for (let c = 0; c < 3; c++) buf[o + c] = getOverlay(buf[o + c]!, px[2]!, 0.2);
      }
    }
  }

  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = buf[i * 3]! * 255;
    img.data[i * 4 + 1] = buf[i * 3 + 1]! * 255;
    img.data[i * 4 + 2] = buf[i * 3 + 2]! * 255;
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

function drawEmblem(buf: Float32Array, size: number, item: DrawItem, mips: RgbaImage[], pattern: RgbaImage | undefined) {
  const [ox, oy] = item.instance.position ?? [0.5, 0.5];
  const [sxRaw, syRaw] = item.instance.scale ?? [1, 1];
  const w = Math.abs(sxRaw);
  const h = Math.abs(syRaw);
  if (w === 0 || h === 0) return;
  // Script rotation is in degrees, clockwise on screen (to be confirmed in game).
  const theta = (-(item.instance.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const tex = new MipSampler(mips, Math.min(w, h) * size);
  const maskColor = item.mask && [1, 2, 3].map((ch) => (item.mask!.includes(ch) ? 1 : 0));

  // Bounding box of the rotated quad in output space.
  const r = Math.hypot(w, h) / 2;
  const x0 = Math.max(0, Math.floor((ox - r) * size));
  const x1 = Math.min(size, Math.ceil((ox + r) * size));
  const y0 = Math.max(0, Math.floor((oy - r) * size));
  const y1 = Math.min(size, Math.ceil((oy + r) * size));

  const px = new Float32Array(4);
  const pp = new Float32Array(4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const X = (x + 0.5) / size;
      const Y = (y + 0.5) / size;
      // Invert the vertex shader: offset/resize, then un-rotate (clip space, y up).
      const rx = (2 * (X - ox)) / w;
      const ry = (-2 * (Y - oy)) / h;
      const qx = cos * rx + sin * ry;
      const qy = -sin * rx + cos * ry;
      if (qx < -1 || qx > 1 || qy < -1 || qy > 1) continue;
      let u = (qx + 1) / 2;
      let v = (1 - qy) / 2;
      if (sxRaw < 0) u = 1 - u;
      if (syRaw < 0) v = 1 - v;
      tex.sample(u, v, px, true);
      let alpha = px[3]!;
      if (maskColor && pattern) {
        sampleBilinear(pattern, X, Y, pp);
        const pr = Math.min(Math.max(pp[0]! - pp[1]! - pp[2]!, 0), 1);
        const pg = Math.min(Math.max(pp[1]! - pp[2]!, 0), 1);
        const pb = pp[2]!;
        alpha *= Math.min(Math.max(pr * maskColor[0]! + pg * maskColor[1]! + pb * maskColor[2]!, 0), 1);
      }
      if (alpha <= 0) continue;
      const o = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) {
        let col: number;
        if (item.kind === 'colored_emblem') {
          const cs = item.colors!;
          col = cs[0]![c]! / 255;
          col += (cs[1]![c]! / 255 - col) * px[1]!;
          col += (cs[2]![c]! / 255 - col) * px[0]!;
          col = getOverlay(col, px[2]!, 1);
        } else col = px[c]!;
        buf[o + c] = buf[o + c]! * (1 - alpha) + col * alpha;
      }
    }
  }
}
