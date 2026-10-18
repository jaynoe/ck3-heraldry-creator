// Geometric checks for problems the model cannot reliably see in a small preview.
//
// Seams: the game samples emblems with wrap addressing, so if an edge of an emblem's quad lies inside
// the shield while the texture is opaque along the OPPOSITE edge, that opaque edge bleeds in as a thin
// line (e.g. a full-size "wall" emblem moved down shows a black line where its top edge now is).

import type { CoatOfArms } from '../coa/model.ts';
import type { RgbaImage } from '../dds/dds.ts';
import type { RenderContext } from '../render/render.ts';

interface EdgeAlpha {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const cache = new WeakMap<RgbaImage, EdgeAlpha>();

function edgeAlpha(img: RgbaImage): EdgeAlpha {
  let e = cache.get(img);
  if (e) return e;
  const { width: w, height: h, data } = img;
  const avg = (n: number, at: (i: number) => number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += data[at(i) * 4 + 3]!;
    return s / n / 255;
  };
  e = {
    top: avg(w, (x) => x),
    bottom: avg(w, (x) => (h - 1) * w + x),
    left: avg(h, (y) => y * w),
    right: avg(h, (y) => y * w + w - 1),
  };
  cache.set(img, e);
  return e;
}

const OPAQUE = 0.25;
/** An edge counts as inside the shield when it is this far from the border. */
const MARGIN = 0.02;
const inside = (v: number) => v > MARGIN && v < 1 - MARGIN;
const fmt = (v: number) => v.toFixed(2);

export async function findSeams(coa: CoatOfArms, ctx: RenderContext): Promise<string[]> {
  const problems: string[] = [];
  for (const e of coa.coloredEmblems) {
    const tex = (await ctx.getTexture('colored_emblem', e.texture))?.[0];
    if (!tex) continue;
    const alpha = edgeAlpha(tex);
    for (const inst of e.instances) {
      if (inst.rotation && Math.abs(inst.rotation) > 1) continue; // rotated quads: skip, rare for ordinaries
      const [x, y] = inst.position ?? [0.5, 0.5];
      const [sx, sy] = inst.scale ?? [1, 1];
      // Mirroring swaps which texture edge ends up on which side.
      const texLeft = sx < 0 ? alpha.right : alpha.left;
      const texRight = sx < 0 ? alpha.left : alpha.right;
      const texTop = sy < 0 ? alpha.bottom : alpha.top;
      const texBottom = sy < 0 ? alpha.top : alpha.bottom;
      const top = y - Math.abs(sy) / 2;
      const bottom = y + Math.abs(sy) / 2;
      const left = x - Math.abs(sx) / 2;
      const right = x + Math.abs(sx) / 2;
      const seams: string[] = [];
      if (inside(top) && texBottom > OPAQUE) seams.push(`a horizontal line at y=${fmt(top)} (its bottom edge is opaque and bleeds to its top edge)`);
      if (inside(bottom) && texTop > OPAQUE) seams.push(`a horizontal line at y=${fmt(bottom)} (its top edge is opaque and bleeds to its bottom edge)`);
      if (inside(left) && texRight > OPAQUE) seams.push(`a vertical line at x=${fmt(left)} (its right edge is opaque and bleeds to its left edge)`);
      if (inside(right) && texLeft > OPAQUE) seams.push(`a vertical line at x=${fmt(right)} (its left edge is opaque and bleeds to its right edge)`);
      for (const s of seams) {
        problems.push(
          `Emblem "${e.texture}" at (${fmt(x)}, ${fmt(y)}) scale ${fmt(Math.abs(sy))} shows ${s} in game. ` +
            'Keep emblems that reach the shield border at full size and centred (0.5, 0.5, scale 1), or choose another emblem or a pattern for that part of the field.',
        );
      }
    }
  }
  return [...new Set(problems)];
}

// Overlaps: charges that cover each other, sit half on a chief, canton or bordure, or run off the shield.
// Each instance is rasterised from its texture's alpha with the renderer's transform, on a coarse grid.

const GRID = 96;
const SOLID_ALPHA = 0.5;
/** Emblems that divide the field (chiefs, bordures, ordinaries); charges belong fully on or off them. */
const COMPARTMENT = /(chief|canton|bordure|border|orle|quarter|base|pale|fess|bend|chevron|saltire|pall|cross|flaunch|pile)/;
const WATER = /(wave|water|sea|nebuly)/;

interface Instance {
  label: string;
  cells: Uint8Array;
  area: number;
  /** Share of the emblem's opaque part that lies outside the shield. */
  outside: number;
  /** Full size and centred: part of the field rather than a charge. */
  field: boolean;
  compartment: boolean;
}

function rasterise(tex: RgbaImage, inst: { position?: [number, number]; scale?: [number, number]; rotation?: number }) {
  const [ox, oy] = inst.position ?? [0.5, 0.5];
  const [sx, sy] = inst.scale ?? [1, 1];
  const w = Math.abs(sx);
  const h = Math.abs(sy);
  const theta = (-(inst.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const alphaAt = (u: number, v: number) => {
    const tx = Math.min(tex.width - 1, Math.floor(u * tex.width));
    const ty = Math.min(tex.height - 1, Math.floor(v * tex.height));
    return tex.data[(ty * tex.width + tx) * 4 + 3]! / 255;
  };
  // On the shield: the same inverse transform as the renderer.
  const cells = new Uint8Array(GRID * GRID);
  let area = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const rx = (2 * ((x + 0.5) / GRID - ox)) / w;
      const ry = (-2 * ((y + 0.5) / GRID - oy)) / h;
      const qx = cos * rx + sin * ry;
      const qy = -sin * rx + cos * ry;
      if (qx < -1 || qx > 1 || qy < -1 || qy > 1) continue;
      let u = (qx + 1) / 2;
      let v = (1 - qy) / 2;
      if (sx < 0) u = 1 - u;
      if (sy < 0) v = 1 - v;
      if (alphaAt(u, v) > SOLID_ALPHA) {
        cells[y * GRID + x] = 1;
        area++;
      }
    }
  }
  // Off the shield: walk the texture and map each opaque sample forward.
  let opaque = 0;
  let out = 0;
  const N = 48;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const v = (j + 0.5) / N;
      if (alphaAt(u, v) <= SOLID_ALPHA) continue;
      opaque++;
      const qx = 2 * (sx < 0 ? 1 - u : u) - 1;
      const qy = 1 - 2 * (sy < 0 ? 1 - v : v);
      const X = ox + ((cos * qx - sin * qy) * w) / 2;
      const Y = oy - ((sin * qx + cos * qy) * h) / 2;
      if (X < -0.01 || X > 1.01 || Y < -0.01 || Y > 1.01) out++;
    }
  }
  return { cells, area, outside: opaque ? out / opaque : 0 };
}

const shared = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && b[i]) n++;
  return n;
};

export async function findOverlaps(coa: CoatOfArms, ctx: RenderContext): Promise<string[]> {
  const items: Instance[] = [];
  for (const e of coa.coloredEmblems) {
    const tex = (await ctx.getTexture('colored_emblem', e.texture))?.[0];
    if (!tex) continue;
    const name = e.texture.toLowerCase();
    for (const [k, inst] of e.instances.entries()) {
      const [x, y] = inst.position ?? [0.5, 0.5];
      const [sx, sy] = inst.scale ?? [1, 1];
      const field = Math.abs(x - 0.5) < 0.03 && Math.abs(y - 0.5) < 0.03 && Math.abs(sx) >= 0.95 && Math.abs(sy) >= 0.95;
      const r = rasterise(tex, inst);
      if (!r.area) continue;
      items.push({
        label: `"${e.texture}"${e.instances.length > 1 ? ` #${k + 1}` : ''} at (${fmt(x)}, ${fmt(y)})`,
        ...r,
        field,
        compartment: field && COMPARTMENT.test(name) && !WATER.test(name),
      });
    }
  }
  const problems: string[] = [];
  const charges = items.filter((i) => !i.field);
  for (const c of charges) {
    if (c.outside > 0.1) problems.push(`${c.label} runs off the shield (${Math.round(c.outside * 100)} % of it is cut off). Move it inside or make it smaller.`);
  }
  for (const [i, a] of charges.entries()) {
    for (const b of charges.slice(i + 1)) {
      const s = shared(a.cells, b.cells) / Math.min(a.area, b.area);
      if (s > 0.12) problems.push(`${a.label} and ${b.label} overlap (${Math.round(s * 100)} % of the smaller one is covered). Give each charge its own space.`);
    }
  }
  for (const part of items.filter((i) => i.compartment)) {
    if (part.area > GRID * GRID * 0.6) continue; // fills most of the field: everything sits on it
    for (const c of charges) {
      // A charge belongs fully on the part (a ship in the canton) or clear of it; touching its edge looks crammed.
      const on = shared(c.cells, part.cells) / c.area;
      if (on > 0.03 && on < 0.85) {
        problems.push(`${c.label} touches or crosses ${part.label.replace(/ at .*/, '')} (${Math.round(on * 100)} % on it). Place it fully on it or keep it clear of it.`);
      }
    }
  }
  return [...new Set(problems)];
}
