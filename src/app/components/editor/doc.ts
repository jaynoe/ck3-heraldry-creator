// What the editor works on; created by Generate, AGOT houses, Collection or "New blank design".

import type { CoatOfArms } from '../../../core/coa/model.ts';

export interface EditorDoc {
  coa: CoatOfArms;
  name: string;
  words?: string;
  idea?: string;
  region?: string;
  parent?: string;
  /** Set when editing a saved design; "Save" then overwrites it. */
  libraryId?: string;
  createdAt?: string;
}

export function blankDoc(): EditorDoc {
  return {
    name: 'New house',
    coa: { pattern: 'pattern_solid.dds', colors: [{ kind: 'named', name: 'agot_blue' }, { kind: 'named', name: 'agot_white' }], coloredEmblems: [], texturedEmblems: [], subs: [] },
  };
}
