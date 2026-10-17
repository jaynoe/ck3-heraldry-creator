// Editing helpers. In the editor the order of `coloredEmblems` IS the drawing order (back to front);
// `depth` values from game files are folded into that order on load and recreated on export.

import type { CoatOfArms, ColoredEmblem, EmblemInstance } from './model.ts';

/**
 * Bring a CoA into editor form: one layer per (emblem, depth) group, sorted back to front,
 * without depth on the instances. Rendering is unchanged.
 */
export function toEditable(coa: CoatOfArms): CoatOfArms {
  const groups: { emblem: ColoredEmblem; depth: number; order: number }[] = [];
  coa.coloredEmblems.forEach((e, order) => {
    const byDepth = new Map<number, EmblemInstance[]>();
    for (const inst of e.instances) {
      const d = inst.depth ?? 0;
      const { depth: _depth, ...rest } = inst;
      byDepth.set(d, [...(byDepth.get(d) ?? []), rest]);
    }
    for (const [depth, instances] of byDepth) groups.push({ emblem: { ...e, instances }, depth, order });
  });
  // Same rule as the renderer: higher depth further back, ties in definition order.
  groups.sort((a, b) => b.depth - a.depth || a.order - b.order);
  return { ...structuredClone(coa), coloredEmblems: groups.map((g) => structuredClone(g.emblem)) };
}

/** Recreate depth values so the game draws layers in editor order (first layer at the back). */
export function withDepths(coa: CoatOfArms): CoatOfArms {
  const n = coa.coloredEmblems.length;
  return {
    ...coa,
    coloredEmblems: coa.coloredEmblems.map((e, i) => {
      const depth = n - 1 - i;
      return {
        ...e,
        instances: e.instances.map((inst) => {
          const { depth: _old, ...rest } = inst;
          return depth > 0 ? { ...rest, depth: depth + 0.01 } : rest;
        }),
      };
    }),
  };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}
