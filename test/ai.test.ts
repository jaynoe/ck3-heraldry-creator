import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/core/catalog/catalog.ts';
import { moreNames, moreWords } from '../src/core/ai/generate.ts';
import { isSafeModelName, withRequestOptions } from '../src/core/ai/mode.ts';
import { cleanWords, ideaToHouseIdea, inspireRuns, snapshotIdea } from '../src/core/ai/inspire.ts';
import type { JsonRequest, LlmProvider } from '../src/core/ai/provider.ts';
import { searchEmblems, type EmblemDoc } from '../src/core/ai/search.ts';
import { coaToSpec, specToCoa, validateSpec, type DesignSpec } from '../src/core/ai/spec.ts';
import { contactSheet, toBase64 } from '../src/core/render/sheet.ts';

const doc = (name: string, usedBy: string[] = []): EmblemDoc => ({
  name,
  tokens: new Set(name.replace('.dds', '').split('_').filter((t) => t !== 'ce')),
  mod: 'test',
  usedBy,
  houseTokens: new Set(usedBy.map((h) => h.toLowerCase())),
  visible: true,
});

const SPEC: DesignSpec = {
  pattern: 'pattern_solid.dds',
  colors: ['agot_red'],
  layers: [
    { texture: 'ce_bend_thin.dds', colors: ['agot_white'], layout: 'full' },
    { texture: 'ce_wolf.dds', colors: ['agot_grey'], placements: [{ x: 0.3, y: 0.5, scale: 0.4, mirror: true, rotation: 15 }] },
  ],
};

describe('design spec', () => {
  it('converts layers back to front using depth, with mirroring and rotation', () => {
    const coa = specToCoa(SPEC);
    expect(coa.coloredEmblems[0]!.instances[0]).toMatchObject({ position: [0.5, 0.5], scale: [1, 1], depth: 1.01 });
    expect(coa.coloredEmblems[1]!.instances[0]).toEqual({ position: [0.3, 0.5], scale: [-0.4, 0.4], rotation: 15 });
  });

  it('round-trips through coaToSpec with explicit placements', () => {
    const back = coaToSpec(specToCoa(SPEC));
    expect(back.layers.map((l) => l.texture)).toEqual(['ce_bend_thin.dds', 'ce_wolf.dds']);
    expect(back.layers[1]!.placements![0]).toMatchObject({ x: 0.3, mirror: true, rotation: 15 });
  });

  it('reports unknown names from the catalog', () => {
    const catalog = {
      assets: { pattern: new Map([['pattern_solid.dds', {}]]), colored_emblem: new Map([['ce_wolf.dds', {}]]), textured_emblem: new Map() },
      namedColors: new Map([['agot_red', {}], ['agot_grey', {}]]),
    } as unknown as Catalog;
    const { ok, errors } = validateSpec(SPEC, catalog);
    expect(ok).toBe(false);
    expect(errors).toEqual(['Unknown emblem "ce_bend_thin.dds"', 'Unknown colour "agot_white" in layer 1 (ce_bend_thin.dds)']);
  });
});

describe('emblem search', () => {
  const index = [doc('ce_wolf_passant.dds'), doc('ce_greyjoy.dds', ['Greyjoy']), doc('ce_tower.dds'), doc('ce_crab.dds', ['Brune'])];

  it('ranks exact tokens and expands synonyms', () => {
    expect(searchEmblems(index, ['direwolf'])[0]!.doc.name).toBe('ce_wolf_passant.dds');
    expect(searchEmblems(index, ['castle']).map((h) => h.doc.name)).toEqual(['ce_tower.dds']);
  });

  it('finds emblems through the houses that use them', () => {
    expect(searchEmblems(index, ['brune'])[0]!.doc.name).toBe('ce_crab.dds');
  });
});

describe('contact sheet', () => {
  it('lays out tiles in a grid and encodes base64 without Buffer', () => {
    const img = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
    const sheet = contactSheet([img, img, img], { tile: 32, columns: 2 });
    expect([sheet.width, sheet.height]).toEqual([2 * 36 + 4, 2 * 36 + 4]);
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });
});

describe('spec colours', () => {
  it('keeps custom colours as #rrggbb and resolves colour references', () => {
    const coa = specToCoa({ pattern: 'p.dds', colors: ['#8b878b', 'agot_white'], layers: [] });
    expect(coa.colors[0]).toEqual({ kind: 'rgb', value: [139, 135, 139] });
    coa.coloredEmblems.push({ texture: 'ce_wolf.dds', colors: [{ kind: 'ref', slot: 2 }], instances: [{}] });
    const spec = coaToSpec(coa);
    expect(spec.colors[0]).toBe('#8b878b');
    expect(spec.layers[0]!.colors).toEqual(['agot_white', 'red', 'red']);
  });
});

describe('follow-up suggestions', () => {
  const catalog = { dynasties: new Map([['dynn_Stark', { key: 'dynn_Stark', name: 'Stark' }]]) } as unknown as Catalog;
  const fake = (answer: unknown) => {
    const requests: JsonRequest[] = [];
    const provider = { id: 'fake', supportsImages: false, generateJson: async (r: JsonRequest) => (requests.push(r), answer) } as unknown as LlmProvider;
    return { provider, requests };
  };
  const context = { idea: 'Ferrymen on the Red Fork', region: 'riverlands', feedback: 'shorter names' };

  it('asks for new names, drops repeats and flags names AGOT already uses', async () => {
    const { provider, requests } = fake({ names: [{ name: 'Tullen', meaning: 'a' }, { name: 'Ferrow', meaning: 'b' }, { name: 'Stark', meaning: 'c' }] });
    const names = await moreNames(provider, catalog, { ...context, shown: ['Tullen'] });
    expect(names.map((n) => n.name)).toEqual(['Ferrow', 'Stark']);
    expect(names[1]!.existing).toBe('dynn_Stark');
    expect(requests[0]!.prompt).toContain('Tullen');
    expect(requests[0]!.prompt).toContain('shorter names');
  });

  it('asks for new words and drops repeats regardless of case', async () => {
    const { provider, requests } = fake({ words: ['Swift as the Current', 'we pay the toll', 'Family, Duty, Honor'] });
    const words = await moreWords(provider, catalog, { ...context, name: 'Tullen', shown: ['We Pay the Toll'] });
    expect(words).toEqual(['Swift as the Current', 'Family, Duty, Honor']);
    expect(requests[0]!.prompt).toContain('House Tullen');
  });
});

describe('AI effort', () => {
  it('adds effort and model to requests; values set on the request win', async () => {
    const seen: JsonRequest[] = [];
    const base = { id: 'x', supportsImages: true, generateJson: async (r: JsonRequest) => (seen.push(r), {}) } as LlmProvider;
    const app = withRequestOptions(withRequestOptions(base, { model: 'sonnet' }), { effort: 'high' });
    await app.generateJson({ label: 'a', system: '', prompt: '', schema: {} });
    await withRequestOptions(app, { effort: 'low' }).generateJson({ label: 'b', system: '', prompt: '', schema: {} });
    expect(seen.map((r) => [r.effort, r.model])).toEqual([
      ['high', 'sonnet'],
      ['low', 'sonnet'],
    ]);
  });

  it('only accepts model names that cannot act as CLI flags', () => {
    expect(['sonnet', 'claude-opus-5-5', 'opus[1m]', 'claude-sonnet-5-5@2026'].map(isSafeModelName)).toEqual([true, true, true, false]);
    expect(['--tools', '', 'a b', 'x;rm'].map(isSafeModelName)).toEqual([false, false, false, false]);
  });
});

describe('run inspiration', () => {
  const catalog = {
    dynasties: new Map([
      ['dynn_Stark', { key: 'dynn_Stark', name: 'Stark', group: 'north', mottos: [] }],
      ['dynn_Reed', { key: 'dynn_Reed', name: 'Reed', group: 'north', mottos: [] }],
    ]),
    coas: new Map([['dynn_Stark', {}], ['dynn_Reed', {}]]),
    bookmarks: [
      { key: 'agot_bm_8259', name: 'The Ninepenny Kings', description: 'A pretender rises.', startDate: '8258.12.21', characters: [{ name: 'Aegon V', dynasty: 'dynn_Stark' }] },
      { key: 'ad_7899', name: '1 AD', description: '', startDate: '7899.8.15', characters: [] },
    ],
    gameRules: [{ key: 'agot_shattered_world', name: 'Shattered World', options: [{ key: 'agot_not_shattered', name: 'Off' }, { key: 'agot_shatter_to_counties', name: 'Counties' }] }],
  } as unknown as Catalog;
  const idea = (o: Record<string, unknown>) => ({
    title: 'T', canon: 'c', concept: 'k', fit: 'f', bookmark: 'agot_bm_8259', start_note: 's', region: 'north', house_kind: 'new', house_name: 'Moatstark',
    parent_house: '', rules: [], sigil: 'tower', words: 'W', catch: 'x', difficulty: 'hard', ...o,
  });

  it('grounds the prompt in the playset and checks every idea against it', async () => {
    const requests: JsonRequest[] = [];
    const provider = {
      id: 'fake',
      supportsImages: false,
      generateJson: async (r: JsonRequest) => (
        requests.push(r),
        {
          ranking: 'r',
          ideas: [
            idea({ house_kind: 'cadet', house_name: 'Moatstark', parent_house: 'House Stark', rules: [{ rule: 'agot_shattered_world', option: 'agot_shatter_to_counties', why: 'w' }, { rule: 'made_up', option: 'x', why: '' }] }),
            idea({ house_kind: 'existing', house_name: 'Reed', bookmark: 'nope' }),
            idea({ house_kind: 'existing', house_name: 'Invented' }),
          ],
        }
      ),
    } as LlmProvider;
    const { ideas } = await inspireRuns(provider, catalog, { playstyle: 'small houses, ruins', shown: ['Old idea'] });
    const prompt = requests[0]!.prompt;
    expect(prompt).toContain('agot_bm_8259: 258 AC "The Ninepenny Kings"');
    expect(prompt).toContain('Free start dates without featured characters exist from -101 AC');
    expect(prompt).toContain('agot_shatter_to_counties "Counties"');
    expect(prompt).toContain('small houses, ruins');
    expect(prompt).toContain('Old idea');

    expect(ideas[0]!.house.dynasty?.key).toBe('dynn_Stark');
    expect(ideas[0]!.rules.map((r) => r.option.name)).toEqual(['Counties']);
    expect(ideas[0]!.notes).toEqual(['The game rule "made_up = x" does not exist here and was left out.']);
    expect(ideas[1]!.house.dynasty?.key).toBe('dynn_Reed');
    expect(ideas[1]!.bookmark).toBeUndefined();
    expect(ideas[1]!.notes[0]).toContain('"nope" is not in this playset');
    expect(ideas[2]!.notes).toEqual(['House Invented was not found in this playset.']);
    expect(ideaToHouseIdea(snapshotIdea(ideas[0]!))).toContain('Sigil direction: tower.');
    const snap = JSON.parse(JSON.stringify(snapshotIdea(ideas[0]!)));
    expect(snap.house).toMatchObject({ kind: 'cadet', dynastyKey: 'dynn_Stark', dynastyName: 'Stark' });
    expect(snap.rules).toEqual([{ name: 'Shattered World', option: 'Counties', why: 'w' }]);
    expect(snap.bookmark).toEqual({ key: 'agot_bm_8259', name: 'The Ninepenny Kings', year: '258 AC' });
  });
});

describe('house words from ideas', () => {
  it('drops quotes and "(my own invention)"', () => {
    expect(cleanWords('“"From the Vine, Plenty" (my own invention)”')).toBe('From the Vine, Plenty');
    expect(cleanWords('Ever Onward')).toBe('Ever Onward');
  });
});

describe('canon check against AWOIAF', () => {
  const catalog = { dynasties: new Map(), coas: new Map(), bookmarks: [], gameRules: [] } as unknown as Catalog;
  const idea = { title: 'Twenty Towers', canon: 'Moat Cailin had fifty towers.', concept: 'k', fit: 'f', bookmark: '', start_note: '', region: 'north', house_kind: 'new', house_name: 'X', parent_house: '', rules: [], sigil: '', words: '', catch: '', difficulty: 'easy', wiki: ['Moat Cailin'] };
  const wiki = async () => [{ title: 'Moat Cailin', url: 'https://awoiaf.westeros.org/index.php/Moat_Cailin', extract: 'Of its twenty towers, three remain.' }];

  it('links the sources and lets the model correct the canon text', async () => {
    const requests: JsonRequest[] = [];
    const provider = {
      id: 'fake',
      supportsImages: false,
      generateJson: async (r: JsonRequest) => (
        requests.push(r),
        r.label === 'canon check' ? { ideas: [{ index: 0, canon: 'Moat Cailin had twenty towers; three still stand.', changed: 'fifty → twenty towers' }] } : { ranking: '', ideas: [idea] }
      ),
    } as LlmProvider;
    const { ideas } = await inspireRuns(provider, catalog, { canon: wiki, checkCanon: true });
    expect(requests.map((r) => r.label)).toEqual(['inspiration', 'canon check']);
    expect(requests[1]!.prompt).toContain('Of its twenty towers, three remain.');
    expect(ideas[0]).toMatchObject({ canon: 'Moat Cailin had twenty towers; three still stand.', canonCheck: 'checked', canonFix: 'fifty → twenty towers' });
    expect(ideas[0]!.sources).toEqual([{ title: 'Moat Cailin', url: 'https://awoiaf.westeros.org/index.php/Moat_Cailin' }]);
  });

  it('only links the sources in Economy, and says so when the wiki cannot be reached', async () => {
    const calls: string[] = [];
    const provider = { id: 'fake', supportsImages: false, generateJson: async (r: JsonRequest) => (calls.push(r.label), { ranking: '', ideas: [idea] }) } as LlmProvider;
    const linked = await inspireRuns(provider, catalog, { canon: wiki, checkCanon: false });
    expect(calls).toEqual(['inspiration']);
    expect(linked.ideas[0]).toMatchObject({ canon: 'Moat Cailin had fifty towers.', canonCheck: 'linked' });
    const offline = await inspireRuns(provider, catalog, { canon: async () => Promise.reject(new Error('offline')), checkCanon: true });
    expect(offline.ideas[0]!.canonCheck).toBe('unreachable');
    expect(offline.ideas[0]!.notes.at(-1)).toContain('could not be reached');
  });
});
