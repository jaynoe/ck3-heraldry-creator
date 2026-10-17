// Named emblem arrangements the model can pick from instead of inventing coordinates.
// Derived from the in-game designer presets (gfx/coat_of_arms/emblem_layouts) and common heraldic placements.

import type { EmblemInstance } from '../coa/model.ts';

export interface LayoutPreset {
  description: string;
  instances: EmblemInstance[];
}

const at = (x: number, y: number, s: number, extra: Partial<EmblemInstance> = {}): EmblemInstance => ({
  position: [x, y],
  scale: [s, s],
  ...extra,
});
const mirrored = (x: number, y: number, s: number): EmblemInstance => ({ position: [x, y], scale: [-s, s] });

export const LAYOUTS: Record<string, LayoutPreset> = {
  full: { description: 'covers the whole shield; use for ordinaries (bend, cross, chevron, bordure, fess …)', instances: [at(0.5, 0.5, 1)] },
  single: { description: 'one charge, centred', instances: [at(0.5, 0.5, 0.75)] },
  single_large: { description: 'one large charge filling most of the shield', instances: [at(0.5, 0.5, 0.9)] },
  in_chief: { description: 'one small charge in the top centre (above a fess or chevron)', instances: [at(0.5, 0.2, 0.3)] },
  in_base: { description: 'one small charge at the bottom centre', instances: [at(0.5, 0.8, 0.3)] },
  canton: { description: 'one small charge in the top-left corner', instances: [at(0.2, 0.2, 0.3)] },
  two_in_pale: { description: 'two charges stacked vertically', instances: [at(0.5, 0.27, 0.45), at(0.5, 0.73, 0.45)] },
  two_combatant: { description: 'two charges side by side facing each other (right one mirrored)', instances: [at(0.3, 0.5, 0.45), mirrored(0.7, 0.5, 0.45)] },
  two_diagonal: { description: 'two charges top-left and bottom-right', instances: [at(0.3, 0.3, 0.4), at(0.7, 0.7, 0.4)] },
  three_2_1: { description: 'three charges, two above one (classic arrangement)', instances: [at(0.27, 0.3, 0.42), at(0.73, 0.3, 0.42), at(0.5, 0.7, 0.42)] },
  three_in_pale: { description: 'three charges stacked vertically', instances: [at(0.5, 0.2, 0.3), at(0.5, 0.5, 0.3), at(0.5, 0.8, 0.3)] },
  three_in_bend: { description: 'three charges along the diagonal from top-left', instances: [at(0.25, 0.25, 0.3), at(0.5, 0.5, 0.3), at(0.75, 0.75, 0.3)] },
  three_in_chief: { description: 'three small charges in a row across the top', instances: [at(0.25, 0.2, 0.25), at(0.5, 0.2, 0.25), at(0.75, 0.2, 0.25)] },
  three_in_fess: { description: 'three charges in a horizontal row across the middle', instances: [at(0.22, 0.5, 0.28), at(0.5, 0.5, 0.28), at(0.78, 0.5, 0.28)] },
  four_quarters: { description: 'four charges, one in each quarter', instances: [at(0.27, 0.27, 0.4), at(0.73, 0.27, 0.4), at(0.27, 0.73, 0.4), at(0.73, 0.73, 0.4)] },
  five_cross: { description: 'five charges arranged as a cross', instances: [at(0.5, 0.2, 0.3), at(0.2, 0.5, 0.3), at(0.5, 0.5, 0.3), at(0.8, 0.5, 0.3), at(0.5, 0.8, 0.3)] },
  six_3_2_1: { description: 'six charges in rows of three, two and one', instances: [at(0.25, 0.25, 0.3), at(0.5, 0.25, 0.3), at(0.75, 0.25, 0.3), at(0.37, 0.5, 0.3), at(0.63, 0.5, 0.3), at(0.5, 0.75, 0.3)] },
  orle: { description: 'eight small charges around the edge of the shield', instances: [at(0.12, 0.12, 0.2), at(0.5, 0.1, 0.2), at(0.88, 0.12, 0.2), at(0.1, 0.5, 0.2), at(0.9, 0.5, 0.2), at(0.15, 0.85, 0.2), at(0.5, 0.92, 0.2), at(0.85, 0.85, 0.2)] },
  semy: {
    description: 'small charges strewn over the whole field (use behind a main charge)',
    instances: [0, 0.2, 0.4, 0.6, 0.8, 1].flatMap((y, row) =>
      (row % 2 ? [0, 0.2, 0.4, 0.6, 0.8, 1] : [0.1, 0.3, 0.5, 0.7, 0.9]).map((x) => at(x, y, 0.18)),
    ),
  },
};
