// Inspiration for a new campaign ("run"): a few concrete starting ideas, grounded in the playset's
// own bookmarks, regions, houses and game rules. One call, text only; no follow-up conversation.

import { bookmarkYear, type Bookmark, type Catalog, type Dynasty, type GameRule } from '../catalog/catalog.ts';
import { AWOIAF, articlesFor, type CanonSource, type WikiArticle } from './canon.ts';
import type { LlmProvider } from './provider.ts';

export type StartKind = 'any' | 'minor' | 'fallen' | 'new' | 'cadet' | 'landless';

export const START_KINDS: Record<StartKind, string> = {
  any: 'Any',
  minor: 'Small house',
  fallen: 'Fallen house to rebuild',
  new: 'New house of my own',
  cadet: 'Cadet branch',
  landless: 'Landless adventurer',
};

export interface InspireOptions {
  /** What the player enjoys, in their own words. */
  playstyle?: string;
  /** Regions, houses or eras already played, to avoid. */
  played?: string;
  /** Region id (dynasty group) to stay in, if any. */
  region?: string;
  start?: StartKind;
  /** Free wish for this round, e.g. "something with ships". */
  wish?: string;
  /** Titles of ideas already shown, so new rounds do not repeat them. */
  shown?: string[];
  count?: number;
  onProgress?: (step: string) => void;
  /** Where canon facts come from (AWOIAF); without it the canon text is the model's own knowledge. */
  canon?: CanonSource;
  /** Let the model correct the canon text against the articles (one extra call). */
  checkCanon?: boolean;
}

/** The steps a run goes through, for the progress list. */
export function inspireSteps(o: Pick<InspireOptions, 'canon' | 'checkCanon'>): string[] {
  return ['Thinking up ideas', 'Checking them against your playset', ...(o.canon ? ['Looking up AWOIAF'] : []), ...(o.canon && o.checkCanon ? ['Checking canon against AWOIAF'] : [])];
}

/** How far the canon text of an idea was checked. */
export type CanonCheck = 'checked' | 'linked' | 'unchecked' | 'unreachable';

export interface IdeaHouse {
  kind: 'existing' | 'new' | 'cadet';
  name: string;
  /** Matched dynasty for an existing house, or the parent of a cadet branch. */
  dynasty?: Dynasty;
  /** For a cadet branch: the parent house as the model named it. */
  parentName?: string;
}

export interface RunIdea {
  title: string;
  canon: string;
  concept: string;
  fit: string;
  /** The bookmark from the playset, if the model picked a valid one. */
  bookmark?: Bookmark;
  /** Start year when no bookmark fits (free start dates), as written by the model. */
  startNote: string;
  region: string;
  house: IdeaHouse;
  rules: { rule: GameRule; option: GameRule['options'][number]; why: string }[];
  sigil: string;
  words: string;
  catch: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Problems found while checking the idea against the playset. */
  notes: string[];
  /** AWOIAF article titles the model based the canon part on. */
  wiki: string[];
  /** The articles that were found for them. */
  sources: { title: string; url: string }[];
  canonCheck: CanonCheck;
  /** What the canon check changed, if anything. */
  canonFix?: string;
}

export interface InspireResult {
  ideas: RunIdea[];
  ranking: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'short, evocative' },
          canon: { type: 'string', description: '2–3 sentences of canon background for the place, house or event' },
          concept: { type: 'string', description: '2–4 sentences: what the player does in this run and the long-term goal' },
          fit: { type: 'string', description: "one or two sentences on why it suits the player's playstyle" },
          bookmark: { type: 'string', description: 'bookmark key from the list, or "" when a free start year fits better' },
          start_note: { type: 'string', description: 'who and where to start, plus the year if no bookmark is used' },
          region: { type: 'string', description: 'region id from the list' },
          house_kind: { type: 'string', enum: ['existing', 'new', 'cadet'] },
          house_name: { type: 'string', description: 'existing: its exact name; new or cadet: a name you propose (without "House")' },
          parent_house: { type: 'string', description: 'cadet only: exact name of the parent house; otherwise ""' },
          rules: {
            type: 'array',
            description: '0–3 game rules worth changing for this run',
            items: {
              type: 'object',
              properties: { rule: { type: 'string' }, option: { type: 'string' }, why: { type: 'string' } },
              required: ['rule', 'option', 'why'],
              additionalProperties: false,
            },
          },
          sigil: { type: 'string', description: 'sigil direction in a few words' },
          words: { type: 'string', description: 'the house words only: no quotation marks, no notes' },
          catch: { type: 'string', description: 'the main risk or what to check in game first (mod mechanics you are unsure about)' },
          wiki: {
            type: 'array',
            items: { type: 'string' },
            description: '2–4 exact article titles on A Wiki of Ice and Fire (awoiaf.westeros.org) that the canon part relies on, e.g. "Moat Cailin", "House Karstark"',
          },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
        },
        required: ['title', 'canon', 'concept', 'fit', 'bookmark', 'start_note', 'region', 'house_kind', 'house_name', 'parent_house', 'rules', 'sigil', 'words', 'catch', 'difficulty', 'wiki'],
        additionalProperties: false,
      },
    },
    ranking: { type: 'string', description: 'two or three sentences: which ideas fit best and how they differ' },
  },
  required: ['ideas', 'ranking'],
  additionalProperties: false,
};

const SYSTEM = `You are a campaign advisor for "A Game of Thrones", a Crusader Kings III mod set in the world of A Song of Ice and Fire.
You suggest starting ideas for a new playthrough that feel true to the books and make for a good game.
- Use only bookmarks and game rules from the lists you are given, with their exact keys.
- Prefer canon places, ruins and fallen houses; say so when something is your own invention.
- Canon means the books and A Wiki of Ice and Fire (awoiaf.westeros.org), not the TV show.
- Be honest about mod mechanics you are not sure of (e.g. whether a ruin can be rebuilt) and put that in "catch".
- Write in English. Be concrete and brief; no follow-up questions.`;

/** Models like to wrap words in quotes or add "(my own invention)"; keep only the words. */
export const cleanWords = (w: string) =>
  w
    .replace(/\s*\((?:my )?own invention\)\s*/gi, ' ')
    .replace(/^[\s"“”‘’]+|[\s"“”‘’]+$/g, '');

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const strip = (name: string) => name.replace(/^House\s+/i, '').trim().toLowerCase();

function bookmarkLines(catalog: Catalog): string {
  const featured = catalog.bookmarks.filter((b) => b.characters.length);
  const lines = featured.map((b) => {
    const chars = b.characters
      .slice(0, 6)
      .map((c) => [c.name, c.dynasty && catalog.dynasties.get(c.dynasty)?.name, c.title].filter(Boolean).join(', '))
      .join('; ');
    return `- ${b.key}: ${bookmarkYear(b.startDate)} "${b.name}"${b.group ? ` (${b.group.split('\n')[0]})` : ''}. ${clip(b.description.replace(/\s+/g, ' '), 180)} Featured: ${chars}`;
  });
  const free = catalog.bookmarks.filter((b) => !b.characters.length);
  if (free.length) lines.push(`- Free start dates without featured characters exist from ${bookmarkYear(free[0]!.startDate)} to ${bookmarkYear(free.at(-1)!.startDate)}; use bookmark "" and give the year in start_note.`);
  return lines.join('\n') || '(none found)';
}

function regionLines(catalog: Catalog): string {
  const byGroup = new Map<string, string[]>();
  for (const d of catalog.dynasties.values()) {
    if (!catalog.coas.has(d.key)) continue;
    const list = byGroup.get(d.group) ?? [];
    if (list.length < 8) list.push(d.name);
    byGroup.set(d.group, list);
  }
  return [...byGroup].map(([g, names]) => `- ${g}: e.g. ${names.join(', ')}`).join('\n');
}

/**
 * Only AGOT's own rules go into the prompt: other mods can add hundreds of options (one playset had
 * 100k characters of them), and the AGOT ones are the ones that shape a campaign (Shattered World, Essos …).
 */
export const promptRules = (catalog: Catalog) =>
  catalog.gameRules
    .filter((r) => /^agot_/i.test(r.key) || /^AGOT\b/i.test(r.name))
    // AGOT's own rules ("AGOT: Shattered World") before those of submods ("AGOT Brightboar: …").
    .sort((a, b) => Number(!/^AGOT:/i.test(a.name)) - Number(!/^AGOT:/i.test(b.name)));

function ruleLines(catalog: Catalog): string {
  const lines: string[] = [];
  let size = 0;
  for (const r of promptRules(catalog)) {
    const line = `- ${r.key} "${r.name.replace(/^AGOT:\s*/i, '')}": ${r.options.map((o) => `${o.key} "${o.name}"`).join(', ')}`;
    if ((size += line.length) > 8000) break; // hard cap, whatever a mod adds
    lines.push(line);
  }
  return lines.join('\n') || '(none)';
}

/** Suggests starting ideas and checks each against the playset. */
export async function inspireRuns(provider: LlmProvider, catalog: Catalog, o: InspireOptions): Promise<InspireResult> {
  const count = o.count ?? 4;
  const wishes = [
    o.playstyle?.trim() && `What the player enjoys:\n"""${o.playstyle.trim()}"""`,
    o.played?.trim() && `Already played (suggest something different):\n"""${o.played.trim()}"""`,
    o.region && `Stay in the region: ${o.region}`,
    o.start && o.start !== 'any' && `Kind of start: ${START_KINDS[o.start]}`,
    o.wish?.trim() && `Wish for this round:\n"""${o.wish.trim()}"""`,
    o.shown?.length && `Ideas already suggested (do not repeat them or close variants): ${o.shown.join('; ')}`,
  ].filter(Boolean);

  o.onProgress?.('Thinking up ideas');
  const raw = (await provider.generateJson({
    label: 'inspiration',
    system: SYSTEM,
    schema: SCHEMA,
    prompt: `Suggest ${count} clearly different ideas for a new AGOT playthrough.
${wishes.join('\n\n') || 'No preferences given: offer a varied mix.'}

Bookmarks in this playset (key: date "name"):
${bookmarkLines(catalog)}

Regions (id: some houses there):
${regionLines(catalog)}

AGOT game rules (key "name": option keys):
${ruleLines(catalog)}

For an existing or parent house use its exact name as it appears in AGOT. Order the ideas from the best fit to the boldest.`,
  })) as { ideas: Record<string, unknown>[]; ranking: string };

  o.onProgress?.('Checking them against your playset');
  const byName = new Map<string, Dynasty>();
  for (const d of catalog.dynasties.values()) if (!byName.has(d.name.toLowerCase()) || catalog.coas.has(d.key)) byName.set(d.name.toLowerCase(), d);
  const bookmarks = new Map(catalog.bookmarks.map((b) => [b.key, b]));
  const rules = new Map(promptRules(catalog).map((r) => [r.key, r]));

  const ideas = raw.ideas.map((i): RunIdea => {
    const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
    const notes: string[] = [];
    const bookmark = str('bookmark') ? bookmarks.get(str('bookmark')) : undefined;
    if (str('bookmark') && !bookmark) notes.push(`The bookmark "${str('bookmark')}" is not in this playset.`);

    const kind = (['existing', 'new', 'cadet'].includes(str('house_kind')) ? str('house_kind') : 'new') as IdeaHouse['kind'];
    const house: IdeaHouse = { kind, name: str('house_name').replace(/^House\s+/i, '') };
    if (kind === 'existing') {
      house.dynasty = byName.get(strip(house.name));
      if (!house.dynasty) notes.push(`House ${house.name} was not found in this playset.`);
    } else if (kind === 'cadet') {
      house.parentName = str('parent_house').replace(/^House\s+/i, '');
      house.dynasty = byName.get(strip(house.parentName));
      if (!house.dynasty) notes.push(`The parent house ${house.parentName} was not found in this playset.`);
    }

    const ideaRules = (Array.isArray(i.rules) ? (i.rules as { rule: string; option: string; why: string }[]) : []).flatMap((r) => {
      const rule = rules.get(r.rule);
      const option = rule?.options.find((x) => x.key === r.option);
      if (!rule || !option) {
        notes.push(`The game rule "${r.rule} = ${r.option}" does not exist here and was left out.`);
        return [];
      }
      return [{ rule, option, why: r.why }];
    });

    return {
      title: str('title'),
      canon: str('canon'),
      concept: str('concept'),
      fit: str('fit'),
      bookmark,
      startNote: str('start_note'),
      region: str('region'),
      house,
      rules: ideaRules,
      sigil: str('sigil'),
      words: cleanWords(str('words')),
      catch: str('catch'),
      difficulty: (['easy', 'medium', 'hard'].includes(str('difficulty')) ? str('difficulty') : 'medium') as RunIdea['difficulty'],
      notes,
      wiki: Array.isArray(i.wiki) ? (i.wiki as unknown[]).filter((w): w is string => typeof w === 'string') : [],
      sources: [],
      canonCheck: 'unchecked',
    };
  });

  if (o.canon) await checkAgainstWiki(provider, ideas, o);
  return { ideas, ranking: raw.ranking ?? '' };
}

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          canon: { type: 'string', description: 'the corrected canon text, 2–3 sentences' },
          changed: { type: 'string', description: 'what was wrong and changed, in one short sentence; "" if nothing' },
        },
        required: ['index', 'canon', 'changed'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

/** Links each idea to its AWOIAF articles and, if asked, lets the model correct the canon text against them. */
async function checkAgainstWiki(provider: LlmProvider, ideas: RunIdea[], o: InspireOptions) {
  o.onProgress?.('Looking up AWOIAF');
  let articles: WikiArticle[];
  try {
    articles = await o.canon!(ideas.flatMap((i) => i.wiki));
  } catch {
    for (const i of ideas) {
      i.canonCheck = 'unreachable';
      i.notes.push('A Wiki of Ice and Fire could not be reached, so the canon text was not checked.');
    }
    return;
  }
  const perIdea = ideas.map((i) => articlesFor(i.wiki, articles));
  ideas.forEach((i, n) => {
    i.sources = perIdea[n]!.map((a) => ({ title: a.title, url: a.url }));
    i.canonCheck = i.sources.length ? 'linked' : 'unchecked';
  });
  if (!o.checkCanon || !articles.length) return;

  o.onProgress?.('Checking canon against AWOIAF');
  const used = [...new Set(perIdea.flat())];
  const ref = (a: WikiArticle) => `A${used.indexOf(a) + 1}`;
  const r = (await provider.generateJson({
    label: 'canon check',
    system: SYSTEM,
    schema: CHECK_SCHEMA,
    prompt: `Check the canon text of each idea against these excerpts from A Wiki of Ice and Fire, the authority on canon.
Correct anything the excerpts contradict. Keep claims the excerpts do not cover only if you are sure of them; otherwise drop them.
Keep the text short (2–3 sentences) and in the same spirit. Do not change anything else.

Excerpts:
${used.map((a) => `[${ref(a)}] ${a.title}\n${a.extract}`).join('\n\n')}

Ideas:
${ideas.map((i, n) => `${n}. ${i.title} (excerpts: ${perIdea[n]!.map(ref).join(', ') || 'none'})\nCanon: ${i.canon}`).join('\n\n')}`,
  })) as { ideas: { index: number; canon: string; changed: string }[] };

  for (const fix of r.ideas ?? []) {
    const idea = ideas[fix.index];
    if (!idea || !perIdea[fix.index]!.length || !fix.canon?.trim()) continue;
    idea.canon = fix.canon.trim();
    idea.canonFix = fix.changed?.trim() || undefined;
    idea.canonCheck = 'checked';
  }
}

export { AWOIAF };

/**
 * A run idea without references into the catalog: what the cards show and what gets saved, so a saved
 * idea stays readable when the playset changes. House arms are looked up again by key when shown.
 */
export interface IdeaSnapshot {
  title: string;
  canon: string;
  concept: string;
  fit: string;
  bookmark?: { key: string; name: string; year: string };
  startNote: string;
  region: string;
  house: { kind: IdeaHouse['kind']; name: string; parentName?: string; dynastyKey?: string; dynastyName?: string };
  rules: { name: string; option: string; why: string }[];
  sigil: string;
  words: string;
  catch: string;
  difficulty: RunIdea['difficulty'];
  notes: string[];
  /** AWOIAF articles behind the canon part (missing in ideas saved before canon checks). */
  sources?: { title: string; url: string }[];
  canonCheck?: CanonCheck;
  canonFix?: string;
}

export function snapshotIdea(i: RunIdea): IdeaSnapshot {
  return {
    title: i.title,
    canon: i.canon,
    concept: i.concept,
    fit: i.fit,
    bookmark: i.bookmark && { key: i.bookmark.key, name: i.bookmark.name, year: bookmarkYear(i.bookmark.startDate) },
    startNote: i.startNote,
    region: i.region,
    house: { kind: i.house.kind, name: i.house.name, parentName: i.house.parentName, dynastyKey: i.house.dynasty?.key, dynastyName: i.house.dynasty?.name },
    rules: i.rules.map((r) => ({ name: r.rule.name.replace(/^AGOT:\s*/i, ''), option: r.option.name, why: r.why })),
    sigil: i.sigil,
    words: i.words,
    catch: i.catch,
    difficulty: i.difficulty,
    notes: i.notes,
    sources: i.sources,
    canonCheck: i.canonCheck,
    canonFix: i.canonFix,
  };
}

/** The idea as a starting text for Generate. */
export function ideaToHouseIdea(idea: IdeaSnapshot): string {
  return [
    `${idea.title}. ${idea.concept}`,
    idea.startNote && `Start: ${idea.startNote}.`,
    idea.sigil && `Sigil direction: ${idea.sigil}.`,
    idea.words && `Words direction: "${idea.words}".`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Plain text for the clipboard. */
export function ideaToText(idea: IdeaSnapshot): string {
  const when = idea.bookmark ? `${idea.bookmark.year} – ${idea.bookmark.name}` : 'free start date';
  return [
    `## ${idea.title}`,
    `Start: ${when}. ${idea.startNote}`,
    `House: ${idea.house.kind === 'cadet' ? `${idea.house.name} (cadet of ${idea.house.parentName})` : `${idea.house.name} (${idea.house.kind})`} · Region: ${idea.region} · Difficulty: ${idea.difficulty}`,
    '',
    `Canon: ${idea.canon}`,
    `Concept: ${idea.concept}`,
    `Why it fits: ${idea.fit}`,
    ...idea.rules.map((r) => `Game rule: ${r.name} = ${r.option} (${r.why})`),
    `Sigil: ${idea.sigil} · Words: "${idea.words}"`,
    `Catch: ${idea.catch}`,
    ...(idea.sources?.length ? [`Sources (A Wiki of Ice and Fire): ${idea.sources.map((s) => s.url).join(' ')}`] : []),
  ].join('\n');
}
