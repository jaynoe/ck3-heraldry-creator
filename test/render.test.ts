import { applyFrame, applyMask, frameFor, frameOpening } from '../src/core/render/frame.ts';
import type { Catalog } from '../src/core/catalog/catalog.ts';
import { describe, expect, it } from 'vitest';
import type { CoatOfArms, ColorValue } from '../src/core/coa/model.ts';
import type { RgbaImage } from '../src/core/dds/dds.ts';
import { findSeams } from '../src/core/ai/checks.ts';
import { renderCoa, type RenderContext } from '../src/core/render/render.ts';

const solid = (r: number, g: number, b: number, a = 255): RgbaImage => ({
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([r, g, b, a]),
});

function context(emblem: RgbaImage): RenderContext {
  return {
    getTexture: async (kind) => [kind === 'pattern' ? solid(255, 0, 0) : emblem],
    getCoa: () => undefined,
    namedColors: new Map<string, ColorValue>([
      ['white', { kind: 'rgb', value: [255, 255, 255] }],
      ['yellow', { kind: 'rgb', value: [255, 255, 0] }],
      ['blue', { kind: 'rgb', value: [0, 0, 255] }],
      ['red', { kind: 'rgb', value: [200, 0, 0] }],
    ]),
  };
}

const coa = (emblemColors: (ColorValue | undefined)[]): CoatOfArms => ({
  pattern: 'p.dds',
  colors: [{ kind: 'named', name: 'white' }, { kind: 'named', name: 'yellow' }],
  coloredEmblems: [{ texture: 'e.dds', colors: emblemColors, instances: [{}] }],
  texturedEmblems: [],
  subs: [],
});

const centre = (img: RgbaImage) => [...img.data.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 3)];
/** Blue 128/255 is not exactly overlay-neutral in the shader math, so allow ±1. */
const expectRgb = (actual: number[], expected: number[]) =>
  actual.forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(1));

describe('renderCoa', () => {
  it('fills the pattern with color1 where the pattern texture is red', async () => {
    const { image } = await renderCoa(coa([]), context(solid(0, 0, 128, 0)), 16);
    expect(centre(image)).toEqual([255, 255, 255]);
  });

  it('uses color2 for the emblem green channel, overlay-neutral at blue 128', async () => {
    const { image } = await renderCoa(coa([{ kind: 'named', name: 'blue' }, { kind: 'named', name: 'blue' }]), context(solid(0, 255, 128)), 16);
    expectRgb(centre(image), [0, 0, 255]);
  });

  it('falls back to named "red" for missing emblem colours, not to the CoA colours', async () => {
    // Green channel → color2, which is not set on the emblem (CoA color2 is yellow).
    const { image } = await renderCoa(coa([{ kind: 'named', name: 'blue' }]), context(solid(0, 255, 128)), 16);
    expectRgb(centre(image), [200, 0, 0]);
  });
});

describe('findSeams', () => {
  // 4x4 texture: transparent top half, opaque bottom half (like a "wall" or "base" emblem).
  const wall: RgbaImage = { width: 4, height: 4, data: new Uint8ClampedArray(64).map((_, i) => (i % 4 === 3 && i >= 32 ? 255 : 0)) };
  const ctx: RenderContext = { getTexture: async () => [wall], getCoa: () => undefined, namedColors: new Map() };
  const withPosition = (y: number): CoatOfArms => ({
    pattern: 'p.dds',
    colors: [],
    coloredEmblems: [{ texture: 'wall.dds', colors: [], instances: [{ position: [0.5, y], scale: [1, 1] }] }],
    texturedEmblems: [],
    subs: [],
  });

  it('flags a full-size emblem moved so its edge lies inside the shield', async () => {
    const problems = await findSeams(withPosition(0.75), ctx);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('y=0.25');
  });

  it('accepts the same emblem centred at full size', async () => {
    expect(await findSeams(withPosition(0.5), ctx)).toEqual([]);
  });
});

describe('shield shapes', () => {
  it('cuts the image with the mask alpha and can keep the outside faint', () => {
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, 255]) };
    const mask = { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 0]) };
    expect([...applyMask(img, mask).data].filter((_, i) => i % 4 === 3)).toEqual([255, 0]);
    expect([...applyMask(img, mask, 0.25).data].filter((_, i) => i % 4 === 3)).toEqual([255, 64]);
  });

  it('draws the chosen tier of the frame strip over the arms', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 255, 255]) };
    // two tiers of 1×1: red (opaque) and green (half transparent)
    const art = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]) };
    expect([...applyFrame(img, art, 0).data]).toEqual([255, 0, 0, 255]);
    expect([...applyFrame(img, art, 1).data]).toEqual([0, 128, 127, 255]);
    expect([...applyFrame(img, art, 9).data]).toEqual([0, 128, 127, 255]); // clamped to the last tier
  });

  it('finds the frame opening: inside the mask and not covered by the frame art', () => {
    // 4×4: mask everywhere, frame art opaque on the outer ring only (one tier)
    const mask = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) };
    const art = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
    for (let i = 0; i < 16; i++) if ([0, 3].includes(i % 4) || i < 4 || i >= 12) art.data[i * 4 + 3] = 255;
    expect(frameOpening(mask, art)).toEqual({ x: 0.25, y: 0.25, size: 0.5 });
  });

  it('picks the frame of the house, then of the parent, then the most common one in the region', () => {
    const catalog = {
      dynasties: new Map([
        ['a', { key: 'a', group: 'north', culture: 'northman' }],
        ['b', { key: 'b', group: 'north', culture: 'northman' }],
        ['c', { key: 'c', group: 'dorne', culture: 'dornish' }],
      ]),
      cultureFrames: new Map([['northman', 'house_frame_andal1'], ['dornish', 'house_frame_round1']]),
    } as unknown as Catalog;
    expect(frameFor(catalog, { house: 'c' })).toBe('house_frame_round1');
    expect(frameFor(catalog, { parent: 'a', region: 'dorne' })).toBe('house_frame_andal1');
    expect(frameFor(catalog, { region: 'dorne' })).toBe('house_frame_round1');
    expect(frameFor(catalog)).toBe('house_frame_andal1');
  });
});
