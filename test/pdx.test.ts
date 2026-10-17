import { describe, expect, it } from 'vitest';
import { getAll, getFirst, getNumbers, isBlock, parsePdx } from '../src/core/pdx/parser.ts';

describe('parsePdx', () => {
  it('keeps duplicate keys in order and parses bare value lists', () => {
    const root = parsePdx(`
      a = { instance = { position = { 0.5 -0.25 } } instance = { rotation = 90 } }
    `);
    const a = getFirst(root, 'a');
    expect(isBlock(a)).toBe(true);
    if (!isBlock(a)) return;
    const instances = getAll(a, 'instance');
    expect(instances).toHaveLength(2);
    expect(getNumbers(getFirst(instances[0] as never, 'position'))).toEqual([0.5, -0.25]);
  });

  it('handles BOM, comments, quoted strings and tagged blocks', () => {
    const root = parsePdx('﻿# comment\nc = rgb { 1 2 3 } # trailing\nname = "A # not comment"');
    const c = getFirst(root, 'c');
    expect(c).toMatchObject({ kind: 'tagged', tag: 'rgb' });
    expect(getFirst(root, 'name')).toBe('A # not comment');
  });

  it('resolves variables declared at any depth and @[ ] expressions', () => {
    const root = parsePdx(`
      @half = 0.5
      x = { @inner = 0.25 v = @inner }
      y = @[half + inner * 2]
    `);
    expect(getFirst(getFirst(root, 'x') as never, 'v')).toBe(0.25);
    expect(getFirst(root, 'y')).toBe(1);
  });

  it('keeps comparison operators', () => {
    const root = parsePdx('a >= 3');
    expect(root.entries[0]).toMatchObject({ key: 'a', op: '>=', value: 3 });
  });
});
