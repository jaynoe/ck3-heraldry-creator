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
