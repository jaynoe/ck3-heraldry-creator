import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { moveItem, toEditable, withDepths } from '../src/core/coa/edit.ts';
import { parseCoaFile } from '../src/core/coa/parse.ts';

describe('editor layers', () => {
  // The rotated fixture lists the lions first, but they carry depths so the bend (depth 6.01) is behind them.
  const coa = [...parseCoaFile(readFileSync(new URL('./fixtures/designer-rotated.txt', import.meta.url), 'utf8')).values()][0]!;

  it('orders layers back to front and splits emblems by depth', () => {
    const editable = toEditable(coa);
    expect(editable.coloredEmblems[0]!.texture).toBe('ce_bend_thin.dds');
    // Six lions with six different depths become six layers, the front one has no depth.
    expect(editable.coloredEmblems.slice(1).map((e) => e.instances[0]!.position)).toEqual([
      [0.505, 0.16],
      [0.75, 0.16],
      [0.75, 0.4],
      [0.235, 0.545],
      [0.31, 0.75],
      [0.53, 0.84],
    ]);
    expect(editable.coloredEmblems.every((e) => e.instances.every((i) => i.depth === undefined))).toBe(true);
    expect(editable.coloredEmblems[5]!.instances[0]!.rotation).toBe(76);
  });

  it('recreates depths so the first layer is drawn at the back', () => {
    const out = withDepths(toEditable(coa));
    expect(out.coloredEmblems[0]!.instances[0]!.depth).toBe(6.01);
    expect(out.coloredEmblems.at(-1)!.instances[0]!.depth).toBeUndefined();
  });

  it('does not modify the original CoA', () => {
    const before = JSON.stringify(coa);
    withDepths(toEditable(coa));
    expect(JSON.stringify(coa)).toBe(before);
  });

  it('moves list items within bounds only', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
