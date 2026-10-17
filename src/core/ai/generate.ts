// Two-step generation:
//   1. concept: names, house words and design directions (motifs as search keywords);
//   2. compose: concrete designs, choosing emblems only from catalog search results.
// Every design is validated against the catalog; invalid ones get one repair round.
// When the user dislikes part of a result, `moreNames`/`moreWords` and `newDesigns` redo just that part.

import type { Catalog, Dynasty } from '../catalog/catalog.ts';
import type { CoatOfArms } from '../coa/model.ts';
import { renderCoa } from '../render/render.ts';
import { contactSheet } from '../render/sheet.ts';
import { checkDesign, designRules, emblemSheet, patternSheet, png, SYSTEM, type Vision } from './design-rules.ts';
import type { JsonRequest, LlmProvider } from './provider.ts';
import { buildEmblemIndex, describeEmblem, searchEmblems, type EmblemDoc } from './search.ts';
import { coaToSpec, DESIGN_SCHEMA, specToCoa, type DesignSpec } from './spec.ts';

export interface GenerateOptions {
  idea: string;
  /** Dynasty key of the parent house for a cadet branch, e.g. "dynn_Tully". */
  parent?: string;
  /** Number of design directions (default 3). */
  variants?: number;
  /**
   * Enables vision: candidate emblems and patterns are shown as numbered sheets, and rendered drafts
   * are reviewed once by the model. Needs a provider with image support.
   */
  vision?: Vision;
  /** Progress messages, e.g. for a CLI spinner. */
  onProgress?: (message: string) => void;
  /** Repair rounds per invalid design (default 1). */
  repairRounds?: number;
  /** A name the player already chose (e.g. from a run idea); it becomes the first name option. */
  name?: string;
  /** House words the player already chose; they become the first option. */
  words?: string;
}

export interface NameOption {
  name: string;
  meaning: string;
  /** Set when an AGOT house with this name already exists. */
  existing?: string;
}

export interface GeneratedDesign {
  title: string;
  blazon: string;
  spec: DesignSpec;
  coa: CoatOfArms;
  /** Validation problems that remained after the repair round. */
  errors: string[];
  /** The model's note from the visual review, if one ran. */
  review?: string;
}

export interface GenerationResult {
  region: string;
  names: NameOption[];
  words: string[];
  designs: GeneratedDesign[];
}

export interface Direction {
  title: string;
  blazon: string;
  tinctures: string[];
  motifs: { role: string; keywords: string[] }[];
}

interface Concept {
  region: string;
  names: { name: string; meaning: string }[];
  words: string[];
  directions: Direction[];
}

const CONCEPT_SCHEMA = {
  type: 'object',
  properties: {
    region: { type: 'string', description: 'one of the region ids listed' },
    names: {
      type: 'array',
      minItems: 4,
      maxItems: 6,
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, meaning: { type: 'string' } },
        required: ['name', 'meaning'],
        additionalProperties: false,
      },
    },
    words: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 6 },
    directions: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          blazon: { type: 'string', description: 'short heraldic description in English' },
          tinctures: { type: 'array', items: { type: 'string' } },
          motifs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['charge', 'ordinary', 'field', 'secondary'] },
                keywords: { type: 'array', items: { type: 'string' } },
              },
              required: ['role', 'keywords'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'blazon', 'tinctures', 'motifs'],
        additionalProperties: false,
      },
    },
  },
  required: ['region', 'names', 'words', 'directions'],
  additionalProperties: false,
};

const DIRECTIONS_SCHEMA = {
  type: 'object',
  properties: { directions: CONCEPT_SCHEMA.properties.directions },
  required: ['directions'],
  additionalProperties: false,
};

const NAMES_SCHEMA = {
  type: 'object',
  properties: { names: CONCEPT_SCHEMA.properties.names },
  required: ['names'],
  additionalProperties: false,
};

const WORDS_SCHEMA = {
  type: 'object',
  properties: { words: CONCEPT_SCHEMA.properties.words },
  required: ['words'],
  additionalProperties: false,
};

const MOTIF_HINT = `For each direction, list tinctures in plain words and motifs with search keywords.
  Emblems are found by keyword search over file names such as "ce_wolf_passant", "ce_bend_wavy", "ce_ship_longship", "ce_greyjoy".
  Use simple English nouns (wolf, heron, tower, wave, bend, chevron, cross, bordure, star …) and, where the motif is a canonical house sigil,
  also that house name as a keyword (e.g. "greyjoy" for a kraken), because many emblems are named after the house that uses them.`;

const COMPOSE_SCHEMA = {
  type: 'object',
  properties: { designs: { type: 'array', items: DESIGN_SCHEMA } },
  required: ['designs'],
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: { designs: { type: 'array', items: DESIGN_SCHEMA }, notes: { type: 'array', items: { type: 'string' } } },
  required: ['designs', 'notes'],
  additionalProperties: false,
};



function regionSamples(catalog: Catalog, perRegion = 6): Map<string, Dynasty[]> {
  const byGroup = new Map<string, Dynasty[]>();
  for (const d of catalog.dynasties.values()) {
    if (!d.mottos.length) continue;
    const list = byGroup.get(d.group) ?? [];
    list.push(d);
    byGroup.set(d.group, list);
  }
  // Deterministic, evenly spread sample per region.
  for (const [g, list] of byGroup) {
    const step = Math.max(1, Math.floor(list.length / perRegion));
    byGroup.set(g, list.filter((_, i) => i % step === 0).slice(0, perRegion));
  }
  return byGroup;
}

function parentBlock(catalog: Catalog, key: string | undefined): string {
  if (!key) return '';
  const d = catalog.dynasties.get(key);
  const coa = catalog.coas.get(key)?.coa;
  if (!d) throw new Error(`Unknown parent house ${key}`);
  return `
This is a CADET BRANCH of House ${d.name} (${d.group}, culture ${d.culture ?? 'unknown'}${d.mottos.length ? `, words "${d.mottos[0]}"` : ''}).
Cadet branches in Westeros usually take a new name (often from their seat, a founder or a variation of the parent name, like Karstark from Stark) and difference the parent's arms: change tinctures, add a bordure, label, bend or canton, or reposition and recolour the main charge — the parent's main charge should stay recognisable.
Parent arms (design format): ${coa ? JSON.stringify(coaToSpec(coa)) : 'unknown'}`;
}

export async function generateHouse(provider: LlmProvider, catalog: Catalog, options: GenerateOptions): Promise<GenerationResult> {
  const variants = options.variants ?? 3;
  options.onProgress?.('Thinking up names, words and design directions');
  const samples = regionSamples(catalog);
  const parent = parentBlock(catalog, options.parent);

  // --- Step 1: concept ---
  const regionLines = [...samples.entries()]
    .map(([g, ds]) => `- ${g}: ${ds.map((d) => `${d.name} ("${d.mottos[0]}")`).join('; ')}`)
    .join('\n');
  const conceptPrompt = `Idea for a new house:
"""${options.idea}"""
${parent}

Regions (id: example houses with their words):
${regionLines}

Return:
- region: the best matching region id
- names: ${variants + 2} name options (without "House"), each with a one-sentence meaning
- words: ${variants + 2} options for the house words
- directions: ${variants} clearly different design directions. ${MOTIF_HINT}${
    options.name ? `\n\nThe player already chose the name "${options.name}": make it the first name option (with its meaning) and add alternatives.` : ''
  }${options.words ? `\nThe player already chose the words "${options.words}": make them the first words option and add alternatives.` : ''}`;
  const concept = (await provider.generateJson({ label: 'concept', system: SYSTEM, prompt: conceptPrompt, schema: CONCEPT_SCHEMA })) as Concept;
  // Whatever the model did, the player's choice comes first.
  if (options.name) {
    const own = concept.names.find((n) => n.name.toLowerCase() === options.name!.toLowerCase()) ?? { name: options.name, meaning: 'From your run idea.' };
    concept.names = [own, ...concept.names.filter((n) => n !== own)];
  }
  if (options.words) concept.words = [options.words, ...concept.words.filter((w) => w.toLowerCase() !== options.words!.toLowerCase())];

  const designs = await composeDesigns(provider, catalog, { ...options, variants, region: concept.region, directions: concept.directions });
  return { region: concept.region, names: markExisting(catalog, concept.names), words: concept.words, designs };
}

/** Flags names that an AGOT house already uses. */
export function markExisting(catalog: Catalog, names: { name: string; meaning: string }[]): NameOption[] {
  const existing = new Map([...catalog.dynasties.values()].map((d) => [d.name.toLowerCase(), d.key]));
  return names.map((n) => {
    const key = existing.get(n.name.replace(/^House\s+/i, '').toLowerCase());
    return key ? { ...n, existing: key } : n;
  });
}

/** What the follow-up steps need to know about the house so far. */
export interface HouseContext {
  idea: string;
  parent?: string;
  region: string;
  /** The chosen name and words, if any. */
  name?: string;
  words?: string;
  /** Optional hint from the user, e.g. "less wolf, more water". */
  feedback?: string;
}

function contextBlock(catalog: Catalog, c: HouseContext): string {
  const lines = [`Idea for a new house:\n"""${c.idea}"""`, parentBlock(catalog, c.parent), `Region: ${c.region}`];
  if (c.name) lines.push(`Chosen name: House ${c.name}`);
  if (c.words) lines.push(`Chosen words: "${c.words}"`);
  if (c.feedback?.trim()) lines.push(`\nThe user says what should be different:\n"""${c.feedback.trim()}"""`);
  return lines.filter(Boolean).join('\n');
}

/** More name options that differ from the ones already shown. */
export async function moreNames(provider: LlmProvider, catalog: Catalog, c: HouseContext & { shown: string[]; count?: number }): Promise<NameOption[]> {
  const r = (await provider.generateJson({
    label: 'more names',
    system: SYSTEM,
    schema: NAMES_SCHEMA,
    prompt: `${contextBlock(catalog, { ...c, name: undefined })}

The user did not like these names (do not repeat them or near variants): ${c.shown.join(', ')}

Return ${c.count ?? 5} NEW name options (without "House") in the naming style of the region, each with a one-sentence meaning.`,
  })) as { names: { name: string; meaning: string }[] };
  const seen = new Set(c.shown.map((n) => n.toLowerCase()));
  return markExisting(catalog, r.names.filter((n) => !seen.has(n.name.toLowerCase())));
}

/** More options for the house words that differ from the ones already shown. */
export async function moreWords(provider: LlmProvider, catalog: Catalog, c: HouseContext & { shown: string[]; count?: number }): Promise<string[]> {
  const r = (await provider.generateJson({
    label: 'more words',
    system: SYSTEM,
    schema: WORDS_SCHEMA,
    prompt: `${contextBlock(catalog, { ...c, words: undefined })}

The user did not like these house words (do not repeat them or close variants):
${c.shown.map((w) => `- "${w}"`).join('\n')}

Return ${c.count ?? 5} NEW options for the house words: short, memorable, in the style of the canonical Westerosi words.`,
  })) as { words: string[] };
  const seen = new Set(c.shown.map((w) => w.toLowerCase()));
  return r.words.filter((w) => !seen.has(w.toLowerCase()));
}

/** New design directions and designs for the chosen name and words, avoiding the designs shown before. */
export async function newDesigns(
  provider: LlmProvider,
  catalog: Catalog,
  c: HouseContext & {
    previous: { title: string; blazon: string }[];
    variants?: number;
    vision?: Vision;
    onProgress?: (message: string) => void;
    repairRounds?: number;
  },
): Promise<GeneratedDesign[]> {
  const variants = c.variants ?? 3;
  c.onProgress?.('Thinking up new design directions');
  const r = (await provider.generateJson({
    label: 'directions',
    system: SYSTEM,
    schema: DIRECTIONS_SCHEMA,
    prompt: `${contextBlock(catalog, c)}

The user did not like these designs:
${c.previous.map((d) => `- ${d.title}: ${d.blazon}`).join('\n')}

Return ${variants} NEW design directions that are clearly different from those and from each other. ${MOTIF_HINT}`,
  })) as { directions: Direction[] };
  return composeDesigns(provider, catalog, { ...c, variants, directions: r.directions });
}

/** Steps 2–4: candidate search, compose, validation with one repair round, and the visual review. */
async function composeDesigns(
  provider: LlmProvider,
  catalog: Catalog,
  options: {
    idea: string;
    parent?: string;
    region: string;
    directions: Direction[];
    variants: number;
    feedback?: string;
    vision?: Vision;
    onProgress?: (message: string) => void;
    repairRounds?: number;
  },
): Promise<GeneratedDesign[]> {
  const { variants } = options;
  const parent = parentBlock(catalog, options.parent);
  const index = buildEmblemIndex(catalog);
  const concept = { region: options.region, directions: options.directions };

  // --- Step 2: candidates ---
  const progress = options.onProgress ?? (() => {});
  const vision = provider.supportsImages ? options.vision : undefined;
  const candidates = new Map<string, { doc: EmblemDoc; no: number }>();
  const directionBlocks = concept.directions.slice(0, variants).map((dir, i) => {
    const lines = dir.motifs.map((m) => {
      const hits = searchEmblems(index, m.keywords, m.role === 'ordinary' ? 8 : 12);
      for (const h of hits) if (!candidates.has(h.doc.name)) candidates.set(h.doc.name, { doc: h.doc, no: candidates.size + 1 });
      const list = hits.map((h) => `    - ${vision ? `#${candidates.get(h.doc.name)!.no} ` : ''}${describeEmblem(h.doc)}`);
      return `  ${m.role} [${m.keywords.join(', ')}]:\n${list.join('\n') || '    (no matches)'}`;
    });
    return `Direction ${i + 1}: ${dir.title}\n  Blazon: ${dir.blazon}\n  Tinctures: ${dir.tinctures.join(', ')}\n${lines.join('\n')}`;
  });

  const patternList = [...catalog.assets.pattern.values()].filter((p) => p.visible).map((p) => p.name);

  const images: JsonRequest['images'] = [];
  if (vision) {
    progress('Rendering candidate sheets');
    images.push(await png(vision, await emblemSheet(vision.ctx, [...candidates.values()].map((c) => c.doc.name))));
    images.push(await png(vision, await patternSheet(vision.ctx, patternList)));
  }
  const regionExamples = [...catalog.dynasties.values()]
    .filter((d) => d.group === concept.region && catalog.coas.has(d.key))
    .slice(0, 3)
    .map((d) => `- ${d.name}: ${JSON.stringify(coaToSpec(catalog.coas.get(d.key)!.coa))}`)
    .join('\n');

  const composePrompt = `Compose ${variants} coats of arms, one per direction, for this house idea:
"""${options.idea}"""
${parent}${options.feedback?.trim() ? `\nThe user's wish for these designs:\n"""${options.feedback.trim()}"""` : ''}

${directionBlocks.join('\n\n')}

${designRules(catalog, patternList, !!vision, 'ONLY emblem file names listed under the directions above.')}

Example arms from the ${concept.region} region in this format:
${regionExamples || '(none)'}`;

  progress('Composing designs');
  const composed = (await provider.generateJson({
    label: 'compose',
    system: SYSTEM,
    prompt: composePrompt,
    schema: COMPOSE_SCHEMA,
    images,
  })) as { designs: unknown[] };

  // --- Step 3: validate (catalog names, and seams when textures are available), then repair rounds ---
  const check = (raw: unknown) => checkDesign(raw, catalog, vision);

  const designs: GeneratedDesign[] = [];
  for (const [i, raw] of composed.designs.slice(0, variants).entries()) {
    const dir = concept.directions[i] ?? concept.directions[0]!;
    let result = await check(raw);
    let attempt = raw;
    for (let round = 0; round < (options.repairRounds ?? 1) && result.errors.length; round++) {
      progress(`Repairing design ${i + 1}`);
      const repaired = await provider.generateJson({
        label: `repair ${i + 1}`,
        system: SYSTEM,
        images,
        prompt: `${composePrompt}\n\nYour design for direction ${i + 1} has errors:\n${result.errors.map((e) => `- ${e}`).join('\n')}\n\nPrevious design: ${JSON.stringify(attempt)}\nReturn the corrected design for direction ${i + 1} only, as the single entry of "designs".`,
        schema: COMPOSE_SCHEMA,
      });
      attempt = (repaired as { designs: unknown[] }).designs[0];
      const fixed = await check(attempt);
      // Keep whichever version has fewer problems.
      if (fixed.errors.length <= result.errors.length) result = fixed;
    }
    designs.push({ title: dir.title, blazon: dir.blazon, spec: result.spec, coa: specToCoa(result.spec), errors: result.errors });
  }

  // --- Step 4: visual review of the rendered drafts ---
  if (vision && designs.length) {
    progress('Reviewing rendered drafts');
    const drafts = await Promise.all(designs.map(async (d) => (await renderCoa(d.coa, vision.ctx, 256)).image));
    const review = (await provider.generateJson({
      label: 'review',
      system: SYSTEM,
      images: [...images, await png(vision, contactSheet(drafts, { tile: 256 }))],
      schema: REVIEW_SCHEMA,
      prompt: `${composePrompt}

Image 3 shows your rendered drafts 1–${designs.length}, as they will look in game:
${designs.map((d, i) => `${i + 1}. ${d.title}: ${JSON.stringify(d.spec)}`).join('\n')}

Review each draft critically against its blazon and the rules: Is the main charge visible and not covered?
Do the emblems look like what was intended? Is the contrast good? Is anything misplaced, cut off or empty?
Watch for thin seam lines across the field: emblems that reach the shield border must stay full size and centred.
Return all ${designs.length} designs in order — unchanged if they are good, otherwise fixed — with a short note each.`,
    })) as { designs: unknown[]; notes: string[] };
    for (const [i, raw] of review.designs.slice(0, designs.length).entries()) {
      const result = await check(raw);
      // Keep the draft if the revision introduces problems.
      if (result.errors.length <= designs[i]!.errors.length) {
        designs[i] = { ...designs[i]!, spec: result.spec, coa: specToCoa(result.spec), errors: result.errors, review: review.notes[i] };
      }
    }
  }

  return designs;
}
