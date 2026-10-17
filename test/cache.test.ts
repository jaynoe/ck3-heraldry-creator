import { describe, expect, it } from 'vitest';
import { deserializeCatalog, playsetFingerprint, serializeCatalog } from '../src/core/catalog/cache.ts';
import type { Catalog } from '../src/core/catalog/catalog.ts';
import type { Layer } from '../src/core/fs/layered.ts';
import type { Playset } from '../src/core/mods/playsets.ts';

const layer = (id: string): Layer => ({ id, name: id, replacePaths: [], source: { label: id, list: async () => [], read: async () => undefined } });

const catalog: Catalog = {
  assets: {
    colored_emblem: new Map([['ce_wolf.dds', { kind: 'colored_emblem', name: 'ce_wolf.dds', file: { path: 'gfx/x/ce_wolf.dds', layer: layer('agot') }, colors: 3, visible: true }]]),
    textured_emblem: new Map(),
    pattern: new Map(),
  },
  namedColors: new Map([['red', { kind: 'rgb', value: [200, 0, 0] }]]),
  designerColors: ['red'],
  coas: new Map([['dynn_X', { key: 'dynn_X', coa: { colors: [], coloredEmblems: [], texturedEmblems: [], subs: [] }, file: { path: 'c.txt', layer: layer('vanilla') } }]]),
  dynasties: new Map(),
  bookmarks: [{ key: 'bm_8259', name: 'The Ninepenny Kings', description: 'd', startDate: '8259.1.1', group: 'Era', characters: [{ name: 'Aegon V', dynasty: 'dynn_Targaryen' }] }],
  gameRules: [{ key: 'agot_shattered_world', name: 'Shattered World', options: [{ key: 'a', name: 'Off' }], default: 'a' }],
  cultureFrames: new Map([['northman', 'house_frame_andal1']]),
  localization: new Map([['k', 'v']]),
};

describe('catalog cache', () => {
  it('round-trips through JSON against fresh layers', () => {
    const json = JSON.parse(JSON.stringify(serializeCatalog(catalog, 'fp', 'Test')));
    const layers = [layer('vanilla'), layer('agot')];
    const back = deserializeCatalog(json, layers)!;
    const wolf = back.assets.colored_emblem.get('ce_wolf.dds')!;
    expect(wolf.colors).toBe(3);
    expect(wolf.file.layer).toBe(layers[1]); // re-linked to the live layer, not a copy
    expect(back.coas.get('dynn_X')!.file.layer).toBe(layers[0]);
    expect(back.bookmarks[0]!.name).toBe('The Ninepenny Kings');
    expect(back.gameRules[0]!.options[0]!.name).toBe('Off');
    expect(back.namedColors.get('red')).toEqual({ kind: 'rgb', value: [200, 0, 0] });
  });

  it('drops entries whose mod is no longer in the playset', () => {
    const json = JSON.parse(JSON.stringify(serializeCatalog(catalog, 'fp', 'Test')));
    const back = deserializeCatalog(json, [layer('vanilla')])!;
    expect(back.assets.colored_emblem.size).toBe(0);
    expect(back.coas.size).toBe(1);
  });

  it('fingerprint changes with mod updates and game version', () => {
    const playset: Playset = { id: 'p', name: 'P', isActive: true, mods: [{ id: 'm', displayName: 'M', source: 'steam', position: 0, version: '1', timeUpdated: 10 }] };
    const base = playsetFingerprint(playset, '1.19');
    expect(playsetFingerprint(playset, '1.20')).not.toBe(base);
    expect(playsetFingerprint({ ...playset, mods: [{ ...playset.mods[0]!, timeUpdated: 11 }] }, '1.19')).not.toBe(base);
    expect(playsetFingerprint(playset, '1.19')).toBe(base);
  });
});
