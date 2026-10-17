import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNamedColors, resolveColor } from '../src/core/coa/colors.ts';
import { parseCoaFile } from '../src/core/coa/parse.ts';
import { serializeCoa } from '../src/core/coa/serialize.ts';

const GREYSTARK = `
house_Greystark = { # Greystark
	pattern = "pattern_solid.dds"
	color2 = rgb {224 235 245}
	color1 = rgb { 139 135 139 }
	colored_emblem = {
		texture = "no_stark_wolf.dds"
		color1 = color2
		color2 = "agot_grey_dark"
		instance = { position = { 0.49 0.5 } scale = { 0.87 0.87 } rotation = -3 }
	}
	sub = { parent = "dynn_Stark" instance = { offset = { 0.5 0 } scale = { 0.5 0.5 } } }
}`;

describe('CoA parsing and serialisation', () => {
  it('parses colours, emblems, instances and subs', () => {
    const coa = parseCoaFile(GREYSTARK).get('house_Greystark')!;
    expect(coa.pattern).toBe('pattern_solid.dds');
    expect(coa.colors[0]).toEqual({ kind: 'rgb', value: [139, 135, 139] });
    const e = coa.coloredEmblems[0]!;
    expect(e.colors[0]).toEqual({ kind: 'ref', slot: 2 });
    expect(e.colors[1]).toEqual({ kind: 'named', name: 'agot_grey_dark' });
    expect(e.instances[0]).toEqual({ position: [0.49, 0.5], scale: [0.87, 0.87], rotation: -3 });
    expect(coa.subs[0]).toEqual({ parent: 'dynn_Stark', instances: [{ offset: [0.5, 0], scale: [0.5, 0.5] }] });
  });

  it('round-trips through serializeCoa', () => {
    const coa = parseCoaFile(GREYSTARK).get('house_Greystark')!;
    const again = parseCoaFile(serializeCoa(coa, 'x')).get('x');
    expect(again).toEqual(coa);
  });

  it.each(['designer-random.txt', 'designer-rotated.txt'])('reproduces the designer clipboard format of %s exactly', (file) => {
    const src = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
    const [key, coa] = [...parseCoaFile(src)][0]!;
    expect(coa.colors[0]).toEqual({ kind: 'named', name: 'white' });
    expect(serializeCoa(coa, key)).toBe(src);
  });

  it('accepts a bare CoA body (pasted without a name)', () => {
    const map = parseCoaFile('pattern = "pattern_solid.dds"\ncolor1 = "red"');
    expect(map.get('')?.colors[0]).toEqual({ kind: 'named', name: 'red' });
  });

  it('resolves named, hsv and referenced colours', () => {
    const named = parseNamedColors('colors = { agot_red = rgb {148 5 3} pure = hsv { 0 1 1 } }');
    expect(resolveColor({ kind: 'named', name: 'agot_red' }, { named })).toEqual([148, 5, 3]);
    expect(resolveColor({ kind: 'named', name: 'pure' }, { named })).toEqual([255, 0, 0]);
    expect(resolveColor({ kind: 'ref', slot: 2 }, { named, slots: [undefined, [1, 2, 3]] })).toEqual([1, 2, 3]);
    expect(resolveColor({ kind: 'named', name: 'missing' }, { named })).toBeUndefined();
  });
});
