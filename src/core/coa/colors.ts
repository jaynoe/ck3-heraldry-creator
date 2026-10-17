import { getFirst, isBlock, parsePdx } from '../pdx/parser.ts';
import type { ColorValue } from './model.ts';
import { parseColorValue } from './parse.ts';

export type Rgb = [number, number, number]; // 0-255

/** Named colours from `common/named_colors/*.txt` (`colors = { name = rgb { … } }`). */
export function parseNamedColors(src: string): Map<string, ColorValue> {
  const out = new Map<string, ColorValue>();
  const colors = getFirst(parsePdx(src), 'colors');
  if (!isBlock(colors)) return out;
  for (const e of colors.entries) {
    const c = parseColorValue(e.value);
    if (c && c.kind !== 'ref' && c.kind !== 'named') out.set(e.key, c);
  }
  return out;
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6]!;
  return [r! * 255, g! * 255, b! * 255];
}

export interface ColorContext {
  named: ReadonlyMap<string, ColorValue>;
  /** Resolved colours of the enclosing CoA, for `colorN` references. */
  slots?: readonly (Rgb | undefined)[];
}

/** Resolve a colour to RGB, or undefined if a name or reference cannot be resolved. */
export function resolveColor(c: ColorValue | undefined, ctx: ColorContext, depth = 0): Rgb | undefined {
  if (!c || depth > 8) return undefined;
  switch (c.kind) {
    case 'rgb':
      return c.value;
    case 'hsv':
      return hsvToRgb(...c.value);
    case 'hsv360':
      return hsvToRgb(c.value[0] / 360, c.value[1] / 100, c.value[2] / 100);
    case 'named':
      return resolveColor(ctx.named.get(c.name), ctx, depth + 1);
    case 'ref':
      return ctx.slots?.[c.slot - 1];
  }
}
