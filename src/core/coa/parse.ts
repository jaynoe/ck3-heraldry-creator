import {
  getAll,
  getFirst,
  getNumbers,
  isBlock,
  parsePdx,
  type PdxBlock,
  type PdxValue,
} from '../pdx/parser.ts';
import {
  emptyCoa,
  type CoatOfArms,
  type ColorValue,
  type ColoredEmblem,
  type EmblemInstance,
  type SubCoa,
  type TexturedEmblem,
} from './model.ts';

const COLOR_KEYS = ['color1', 'color2', 'color3', 'color4', 'color5'];

/** Interpret a script value as a colour (named, `rgb {}`, `hsv {}`, `hsv360 {}`, `hex {}` or `colorN` ref). */
export function parseColorValue(v: PdxValue | undefined): ColorValue | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string') {
    const ref = /^color([1-5])$/.exec(v);
    return ref ? { kind: 'ref', slot: Number(ref[1]) } : { kind: 'named', name: v };
  }
  if (typeof v === 'number') return undefined;
  const block = v.kind === 'tagged' ? v.block : v;
  const tag = v.kind === 'tagged' ? v.tag.toLowerCase() : 'rgb';
  if (tag === 'hex') {
    const hex = String(block.values[0] ?? '').replace(/^#|^0x/i, '');
    const n = parseInt(hex.slice(0, 6), 16);
    return { kind: 'rgb', value: [(n >> 16) & 255, (n >> 8) & 255, n & 255] };
  }
  const nums = getNumbers(block);
  if (nums.length < 3) return undefined;
  const triple: [number, number, number] = [nums[0]!, nums[1]!, nums[2]!];
  if (tag === 'hsv') return { kind: 'hsv', value: triple };
  if (tag === 'hsv360') return { kind: 'hsv360', value: triple };
  if (tag === 'rgb') return { kind: 'rgb', value: triple };
  return undefined;
}

function pair(v: PdxValue | undefined): [number, number] | undefined {
  const n = getNumbers(v);
  return n.length >= 2 ? [n[0]!, n[1]!] : undefined;
}

function parseInstance(b: PdxBlock): EmblemInstance {
  const inst: EmblemInstance = {};
  const position = pair(getFirst(b, 'position'));
  const scale = pair(getFirst(b, 'scale'));
  const rotation = getFirst(b, 'rotation');
  const depth = getFirst(b, 'depth');
  if (position) inst.position = position;
  if (scale) inst.scale = scale;
  if (typeof rotation === 'number') inst.rotation = rotation;
  if (typeof depth === 'number') inst.depth = depth;
  return inst;
}

function instancesOf(b: PdxBlock): EmblemInstance[] {
  const list = getAll(b, 'instance').filter(isBlock).map(parseInstance);
  // An emblem without instances is drawn once with default placement.
  return list.length ? list : [{}];
}

function maskOf(b: PdxBlock): number[] | undefined {
  const m = getFirst(b, 'mask');
  return m === undefined ? undefined : getNumbers(m);
}

function parseColoredEmblem(b: PdxBlock): ColoredEmblem | undefined {
  const texture = getFirst(b, 'texture');
  if (typeof texture !== 'string') return undefined;
  const e: ColoredEmblem = {
    texture,
    colors: COLOR_KEYS.slice(0, 3).map((k) => parseColorValue(getFirst(b, k))),
    instances: instancesOf(b),
  };
  const mask = maskOf(b);
  if (mask) e.mask = mask;
  return e;
}

function parseTexturedEmblem(b: PdxBlock): TexturedEmblem | undefined {
  const texture = getFirst(b, 'texture');
  if (typeof texture !== 'string') return undefined;
  const e: TexturedEmblem = { texture, instances: instancesOf(b) };
  const mask = maskOf(b);
  if (mask) e.mask = mask;
  return e;
}

function parseSub(b: PdxBlock): SubCoa {
  const instances = getAll(b, 'instance')
    .filter(isBlock)
    .map((ib) => {
      const offset = pair(getFirst(ib, 'offset'));
      const scale = pair(getFirst(ib, 'scale'));
      return { ...(offset && { offset }), ...(scale && { scale }) };
    });
  const sub: SubCoa = { instances: instances.length ? instances : [{}] };
  const parent = getFirst(b, 'parent');
  if (typeof parent === 'string') sub.parent = parent;
  else sub.coa = coaFromBlock(b);
  return sub;
}

/** Convert one parsed CoA definition block into the model. */
export function coaFromBlock(b: PdxBlock): CoatOfArms {
  const coa = emptyCoa();
  const parent = getFirst(b, 'parent');
  const pattern = getFirst(b, 'pattern');
  if (typeof parent === 'string') coa.parent = parent;
  if (typeof pattern === 'string') coa.pattern = pattern;
  coa.colors = COLOR_KEYS.map((k) => parseColorValue(getFirst(b, k)));
  while (coa.colors.length && coa.colors.at(-1) === undefined) coa.colors.pop();
  for (const e of b.entries) {
    if (!isBlock(e.value)) continue;
    if (e.key === 'colored_emblem') {
      const ce = parseColoredEmblem(e.value);
      if (ce) coa.coloredEmblems.push(ce);
    } else if (e.key === 'textured_emblem') {
      const te = parseTexturedEmblem(e.value);
      if (te) coa.texturedEmblems.push(te);
    } else if (e.key === 'sub') {
      coa.subs.push(parseSub(e.value));
    }
  }
  return coa;
}

/** Keys at file level that are not CoA definitions. */
const NON_COA_KEYS = new Set(['template', 'templates']);

/**
 * Parse a `common/coat_of_arms/coat_of_arms/*.txt` file (or a pasted CoA) into named definitions.
 * Accepts both `name = { pattern = … }` lists and a bare CoA body.
 */
export function parseCoaFile(src: string): Map<string, CoatOfArms> {
  const root = parsePdx(src);
  const out = new Map<string, CoatOfArms>();
  const looksBare = root.entries.some((e) => e.key === 'pattern' || e.key === 'colored_emblem');
  if (looksBare) {
    out.set('', coaFromBlock(root));
    return out;
  }
  for (const e of root.entries) {
    if (!isBlock(e.value) || NON_COA_KEYS.has(e.key)) continue;
    out.set(e.key, coaFromBlock(e.value));
  }
  return out;
}
