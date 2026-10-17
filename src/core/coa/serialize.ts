import type { CoatOfArms, ColorValue, EmblemInstance, SubCoa } from './model.ts';

// Output mirrors the in-game designer's clipboard format (see test/fixtures/designer-random.txt):
// `key={`, 4-space indent, unquoted colour names, quoted textures, numbers with 6 decimals.

const IND = '    ';
const num = (n: number) => n.toFixed(6);
const pair = (p: [number, number]) => `{ ${num(p[0])} ${num(p[1])} }`;

export function serializeColor(c: ColorValue): string {
  switch (c.kind) {
    case 'named':
      return /^[A-Za-z0-9_]+$/.test(c.name) ? c.name : `"${c.name}"`;
    case 'ref':
      return `color${c.slot}`;
    case 'rgb':
      return `rgb { ${c.value.map((v) => Math.round(v)).join(' ')} }`;
    case 'hsv':
    case 'hsv360':
      return `${c.kind} { ${c.value.map((v) => +v.toFixed(4)).join(' ')} }`;
  }
}

function instanceLines(i: EmblemInstance, ind: string): string[] {
  const lines = [`${ind}instance={`];
  if (i.position) lines.push(`${ind}${IND}position=${pair(i.position)}`);
  if (i.scale) lines.push(`${ind}${IND}scale=${pair(i.scale)}`);
  if (i.depth !== undefined) lines.push(`${ind}${IND}depth=${num(i.depth)}`);
  // The designer writes rotation as a plain integer, after depth.
  if (i.rotation) lines.push(`${ind}${IND}rotation=${+i.rotation.toFixed(6)}`);
  lines.push(`${ind}}`, '');
  return lines;
}

function subLines(s: SubCoa, ind: string): string[] {
  const inner = ind + IND;
  const lines = [`${ind}sub={`];
  if (s.parent) lines.push(`${inner}parent="${s.parent}"`);
  else if (s.coa) lines.push(...bodyLines(s.coa, inner));
  for (const i of s.instances) {
    lines.push(`${inner}instance={`);
    if (i.offset) lines.push(`${inner}${IND}offset=${pair(i.offset)}`);
    if (i.scale) lines.push(`${inner}${IND}scale=${pair(i.scale)}`);
    lines.push(`${inner}}`, '');
  }
  lines.push(`${ind}}`, '');
  return lines;
}

function emblemLines(
  tag: string,
  e: { texture: string; colors?: (ColorValue | undefined)[]; mask?: number[]; instances: EmblemInstance[] },
  ind: string,
): string[] {
  const inner = ind + IND;
  const lines = [`${ind}${tag}={`];
  e.colors?.forEach((c, i) => c && lines.push(`${inner}color${i + 1}=${serializeColor(c)}`));
  lines.push(`${inner}texture="${e.texture}"`);
  if (e.mask) lines.push(`${inner}mask={ ${e.mask.join(' ')} }`);
  // A single default instance is implicit, as in the designer's output.
  const implicit = e.instances.length === 1 && Object.keys(e.instances[0]!).length === 0;
  if (!implicit) for (const i of e.instances) lines.push(...instanceLines(i, inner));
  lines.push(`${ind}}`, '');
  return lines;
}

function bodyLines(coa: CoatOfArms, ind: string): string[] {
  const lines: string[] = [];
  if (coa.parent) lines.push(`${ind}parent="${coa.parent}"`);
  if (coa.pattern) lines.push(`${ind}pattern="${coa.pattern}"`);
  coa.colors.forEach((c, i) => c && lines.push(`${ind}color${i + 1}=${serializeColor(c)}`));
  for (const e of coa.texturedEmblems) lines.push(...emblemLines('textured_emblem', e, ind));
  for (const e of coa.coloredEmblems) lines.push(...emblemLines('colored_emblem', e, ind));
  for (const s of coa.subs) lines.push(...subLines(s, ind));
  return lines;
}

/** Serialise a CoA in the in-game designer's clipboard format, ready to paste. */
export function serializeCoa(coa: CoatOfArms, name = 'custom_coa'): string {
  return [`${name}={`, ...bodyLines(coa, IND), '}', ''].join('\n');
}
