import { describe, expect, it } from 'vitest';
import { findOverlaps } from '../src/core/ai/checks.ts';
import type { CoatOfArms, ColoredEmblem } from '../src/core/coa/model.ts';
import type { RgbaImage } from '../src/core/dds/dds.ts';
import type { RenderContext } from '../src/core/render/render.ts';

/** 32×32 texture, opaque where `opaque(u, v)` (0..1) is true. */
function texture(opaque: (u: number, v: number) => boolean): RgbaImage {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) data[(y * 32 + x) * 4 + 3] = opaque((x + 0.5) / 32, (y + 0.5) / 32) ? 255 : 0;
  return { width: 32, height: 32, data };
}
const textures: Record<string, RgbaImage> = {
  'ce_disc.dds': texture((u, v) => (u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.2),
  'ce_ordinary_canton.dds': texture((u, v) => u < 0.4 && v < 0.4),
};
const ctx: RenderContext = { getTexture: async (_k, name) => (textures[name] ? [textures[name]] : undefined), getCoa: () => undefined, namedColors: new Map() };
const charge = (texture: string, x: number, y: number, s: number): ColoredEmblem => ({ texture, colors: [], instances: [{ position: [x, y], scale: [s, s] }] });
const arms = (...coloredEmblems: ColoredEmblem[]): CoatOfArms => ({ pattern: 'pattern_solid.dds', colors: [], coloredEmblems, texturedEmblems: [], subs: [] });
const canton = charge('ce_ordinary_canton.dds', 0.5, 0.5, 1);

describe('findOverlaps', () => {
  it('accepts charges with their own space', async () => {
    expect(await findOverlaps(arms(canton, charge('ce_disc.dds', 0.2, 0.2, 0.3), charge('ce_disc.dds', 0.65, 0.65, 0.5)), ctx)).toEqual([]);
  });

  it('reports overlapping charges, a charge crossing the canton and one running off the shield', async () => {
    const overlap = await findOverlaps(arms(charge('ce_disc.dds', 0.4, 0.5, 0.5), charge('ce_disc.dds', 0.6, 0.5, 0.5)), ctx);
    expect(overlap.join()).toMatch(/overlap/);
    const crossing = await findOverlaps(arms(canton, charge('ce_disc.dds', 0.45, 0.45, 0.4)), ctx);
    expect(crossing.join()).toMatch(/touches or crosses "ce_ordinary_canton.dds"/);
    const off = await findOverlaps(arms(charge('ce_disc.dds', 0.95, 0.5, 0.5)), ctx);
    expect(off.join()).toMatch(/runs off the shield/);
  });
});
