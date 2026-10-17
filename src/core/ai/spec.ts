// The compact design format the model fills in, and its conversion to and from the CoA model.
// Layers are listed back to front; each uses either a named layout or explicit placements.

import type { Catalog } from '../catalog/catalog.ts';
import { resolveColor } from '../coa/colors.ts';
import { emptyCoa, type CoatOfArms, type ColorValue, type EmblemInstance } from '../coa/model.ts';
import { LAYOUTS } from './layouts.ts';

export interface Placement {
  x: number;
  y: number;
  scale: number;
  rotation?: number;
  mirror?: boolean;
}

export interface LayerSpec {
  texture: string;
  /** Up to three named colours; [0] is the main colour. */
  colors: string[];
  layout?: string;
  placements?: Placement[];
}

export interface DesignSpec {
  pattern: string;
  /** Field colours: color1, color2, color3 (named colours). */
  colors: string[];
  layers: LayerSpec[];
}

const PLACEMENT_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'centre x, 0 = left, 1 = right' },
    y: { type: 'number', description: 'centre y, 0 = top, 1 = bottom' },
    scale: { type: 'number', description: '1 = full shield width' },
    rotation: { type: 'number', description: 'degrees, clockwise' },
    mirror: { type: 'boolean', description: 'flip horizontally (face the other way)' },
  },
  required: ['x', 'y', 'scale'],
  additionalProperties: false,
};

export const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: 'pattern file name from the list' },
    colors: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: 'field colours color1..color3' },
    layers: {
      type: 'array',
      description: 'emblem layers, back to front',
      items: {
        type: 'object',
        properties: {
          texture: { type: 'string', description: 'emblem file name from the candidates' },
          colors: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
          layout: { type: 'string', description: 'named layout; omit when using placements' },
          placements: { type: 'array', items: PLACEMENT_SCHEMA },
        },
        required: ['texture', 'colors'],
        additionalProperties: false,
      },
    },
  },
  required: ['pattern', 'colors', 'layers'],
  additionalProperties: false,
} as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** Spec colours are palette names or "#rrggbb" for custom colours. */
const named = (name: string): ColorValue =>
  HEX.test(name)
    ? { kind: 'rgb', value: [1, 3, 5].map((i) => parseInt(name.slice(i, i + 2), 16)) as [number, number, number] }
    : { kind: 'named', name };
const round = (n: number) => Math.round(n * 1000) / 1000;

function placementToInstance(p: Placement, depth: number): EmblemInstance {
  const s = round(p.scale);
  const inst: EmblemInstance = { position: [round(p.x), round(p.y)], scale: [p.mirror ? -s : s, s] };
  if (p.rotation) inst.rotation = Math.round(p.rotation);
  if (depth > 0) inst.depth = depth;
  return inst;
}

/** Convert a validated spec into a CoA. Earlier layers get a higher depth so they are drawn behind. */
export function specToCoa(spec: DesignSpec): CoatOfArms {
  const coa = emptyCoa();
  coa.pattern = spec.pattern;
  coa.colors = spec.colors.map(named);
  const n = spec.layers.length;
  spec.layers.forEach((layer, i) => {
    const depth = n - 1 - i > 0 ? n - 1 - i + 0.01 : 0;
    const instances = layer.placements?.length
      ? layer.placements.map((p) => placementToInstance(p, depth))
      : (LAYOUTS[layer.layout ?? 'single']?.instances ?? LAYOUTS.single!.instances).map((inst) => ({
          ...inst,
          ...(depth > 0 && { depth }),
        }));
    coa.coloredEmblems.push({ texture: layer.texture, colors: layer.colors.map(named), instances });
  });
  return coa;
}

/** Describe an existing CoA as a spec (with explicit placements), e.g. to show a parent house's arms. */
export function coaToSpec(coa: CoatOfArms): DesignSpec {
  const colorName = (c: ColorValue | undefined, depth = 0): string => {
    if (!c) return 'red'; // the game's default for missing emblem colours
    if (c.kind === 'named') return c.name;
    if (c.kind === 'ref') return depth < 4 ? colorName(coa.colors[c.slot - 1], depth + 1) : 'red';
    const rgb = resolveColor(c, { named: new Map() });
    return rgb ? '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : 'red';
  };
  const items = coa.coloredEmblems.flatMap((e, order) =>
    e.instances.map((inst) => ({ e, inst, order, depth: inst.depth ?? 0 })),
  );
  // Group back to front by depth, then definition order.
  items.sort((a, b) => b.depth - a.depth || a.order - b.order);
  const layers: LayerSpec[] = [];
  for (const { e, inst } of items) {
    const placement: Placement = {
      x: inst.position?.[0] ?? 0.5,
      y: inst.position?.[1] ?? 0.5,
      scale: Math.abs(inst.scale?.[1] ?? 1),
      ...(inst.rotation ? { rotation: inst.rotation } : {}),
      ...((inst.scale?.[0] ?? 1) < 0 ? { mirror: true } : {}),
    };
    const last = layers.at(-1);
    const colors = [0, 1, 2].map((i) => colorName(e.colors[i]));
    if (last && last.texture === e.texture && last.colors.join() === colors.join()) last.placements!.push(placement);
    else layers.push({ texture: e.texture, colors, placements: [placement] });
  }
  return {
    pattern: coa.pattern ?? 'pattern_solid.dds',
    colors: coa.colors.map((c) => colorName(c)),
    layers,
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  spec: DesignSpec;
}

/** Check names against the catalog and clamp numbers into sane ranges. */
export function validateSpec(raw: unknown, catalog: Catalog): ValidationResult {
  const errors: string[] = [];
  const spec = structuredClone(raw) as DesignSpec;
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.layers) || !Array.isArray(spec.colors)) {
    return { ok: false, errors: ['Response does not match the design format'], spec: { pattern: 'pattern_solid.dds', colors: [], layers: [] } };
  }
  const checkColor = (c: string, where: string) => {
    if (!HEX.test(c) && !catalog.namedColors.has(c)) errors.push(`Unknown colour "${c}" in ${where}`);
  };
  if (!catalog.assets.pattern.has(spec.pattern)) errors.push(`Unknown pattern "${spec.pattern}"`);
  spec.colors.forEach((c) => checkColor(c, 'field colours'));
  spec.layers.forEach((l, i) => {
    const where = `layer ${i + 1} (${l.texture})`;
    if (!catalog.assets.colored_emblem.has(l.texture)) errors.push(`Unknown emblem "${l.texture}"`);
    l.colors.forEach((c) => checkColor(c, where));
    if (l.layout && !LAYOUTS[l.layout]) errors.push(`Unknown layout "${l.layout}" in ${where}`);
    if (!l.layout && !l.placements?.length) l.layout = 'single';
    for (const p of l.placements ?? []) {
      p.x = Math.min(Math.max(p.x, 0), 1);
      p.y = Math.min(Math.max(p.y, 0), 1);
      p.scale = Math.min(Math.max(p.scale, 0.05), 1.5);
    }
  });
  if (spec.layers.length > 8) errors.push('Too many layers (max 8)');
  return { ok: errors.length === 0, errors, spec };
}
