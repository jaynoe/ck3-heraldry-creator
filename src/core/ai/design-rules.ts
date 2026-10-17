// Prompt parts and helpers shared by house generation (generate.ts) and design refinement (refine.ts).

import type { Catalog } from '../catalog/catalog.ts';
import { resolveColor } from '../coa/colors.ts';
import type { ColorValue } from '../coa/model.ts';
import type { RgbaImage } from '../dds/dds.ts';
import { renderCoa, type RenderContext } from '../render/render.ts';
import { contactSheet, toBase64 } from '../render/sheet.ts';
import { findSeams } from './checks.ts';
import { LAYOUTS } from './layouts.ts';
import { specToCoa, validateSpec } from './spec.ts';

/** Rendering access for vision-capable providers. */
export interface Vision {
  ctx: RenderContext;
  encodePng: (img: RgbaImage) => Uint8Array | Promise<Uint8Array>;
}

export const hex = (rgb: [number, number, number] | undefined) =>
  rgb ? '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : '?';

const rgb = (r: number, g: number, b: number): ColorValue => ({ kind: 'rgb', value: [r, g, b] });
const SAMPLE_COLORS = { field: rgb(96, 104, 112), c1: rgb(230, 215, 170), c2: rgb(70, 45, 30), c3: rgb(190, 30, 30) };

export const png = async (v: Vision, img: RgbaImage) => ({
  mediaType: 'image/png' as const,
  base64: toBase64(await v.encodePng(img)),
});

export async function emblemSheet(ctx: RenderContext, names: string[]): Promise<RgbaImage> {
  const tiles = await Promise.all(
    names.map(async (texture) => {
      const { image } = await renderCoa(
        {
          pattern: 'pattern_solid.dds',
          colors: [SAMPLE_COLORS.field],
          coloredEmblems: [{ texture, colors: [SAMPLE_COLORS.c1, SAMPLE_COLORS.c2, SAMPLE_COLORS.c3], instances: [{}] }],
          texturedEmblems: [],
          subs: [],
        },
        ctx,
        128,
      );
      return image;
    }),
  );
  return contactSheet(tiles, { tile: 128, columns: 8 });
}

export async function patternSheet(ctx: RenderContext, names: string[]): Promise<RgbaImage> {
  const tiles = await Promise.all(
    names.map(async (pattern) => {
      const { image } = await renderCoa(
        { pattern, colors: [SAMPLE_COLORS.c1, SAMPLE_COLORS.c2, SAMPLE_COLORS.c3], coloredEmblems: [], texturedEmblems: [], subs: [] },
        ctx,
        80,
      );
      return image;
    }),
  );
  return contactSheet(tiles, { tile: 80, columns: 12 });
}

export const SYSTEM = `You are a heraldry designer and loremaster for "A Game of Thrones", a Crusader Kings III mod set in the world of A Song of Ice and Fire.
You create houses that feel native to Westeros and Essos: names, house words and coats of arms.
- House names follow the region's naming style (First Men in the North, Andal houses in the Vale and Westerlands, Rhoynish names in Dorne, Valyrian names, …). Never reuse a canonical house name.
- House words are short, evocative and in the style of the canon (e.g. "Winter is Coming", "Unbowed, Unbent, Unbroken", "We Do Not Sow").
- Arms are clear and readable at small size: one strong main charge or a bold ordinary, at most three emblem layers.
- Respect the rule of tincture where sensible: avoid light charges on light fields and dark on dark.
- Do not copy the arms of a canonical great house.`;

/** Rules for the DesignSpec format, shared by generation and refinement prompts. */
export function designRules(catalog: Catalog, patternList: string[], vision: boolean, textureRule: string): string {
  const palette = catalog.designerColors
    .map((c) => `${c} ${hex(resolveColor({ kind: 'named', name: c }, { named: catalog.namedColors }))}`)
    .join(', ');
  const patterns = vision ? patternList.map((p, i) => `P${i + 1} ${p}`).join(', ') : patternList.join(', ');
  const layouts = Object.entries(LAYOUTS).map(([k, l]) => `- ${k}: ${l.description}`).join('\n');
  return `Rules for the design format:
- pattern: one of: ${patterns}
  "pattern_solid.dds" is a plain field (only color1 matters). Split patterns use color1 and color2 (and color3 if three parts).
- colors (field) and layer colors: these named colours: ${palette}
  (a "#rrggbb" value already used in the current design may be kept).
- texture: ${textureRule}${
    vision
      ? `
- Image 1 shows every candidate emblem, numbered as in the lists (#n), drawn full-size in sample colours
  (colour 1 = beige, colour 2 = dark brown, colour 3 = red) on a grey field. Check the actual shapes:
  e.g. a "bordure" emblem must be a hollow border, not a filled shield; a "chief" covers only the top.
- Image 2 shows the patterns P1… with color1 = light, color2 = dark, color3 = red.`
      : ''
  }
- Emblem colours: colour 1 is the main body; colours 2 and 3 are details (claws, tongue, eyes, outlines) — only needed when the emblem has 2 or 3 colours.
- Layers are drawn back to front. Put ordinaries ("full" layout) before charges.
- Emblems that reach the shield border (ordinaries, walls, borders, bases) must stay full size and centred ("full" layout).
  Moving or shrinking them leaves a visible seam line in game. To fill only part of the field, use a pattern or an emblem drawn for that part.
- Use a named layout, or explicit placements {x, y, scale, rotation?, mirror?} (0..1, y down) when needed. Layouts:
${layouts}`;
}

/** Validate against the catalog, and check for seams when textures are available. */
export async function checkDesign(raw: unknown, catalog: Catalog, vision: Vision | undefined) {
  const result = validateSpec(raw, catalog);
  const seams = result.ok && vision ? await findSeams(specToCoa(result.spec), vision.ctx) : [];
  return { spec: result.spec, errors: [...result.errors, ...seams] };
}
