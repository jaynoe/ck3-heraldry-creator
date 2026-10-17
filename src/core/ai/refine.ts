// Refine an existing design from a plain-language instruction ("yellow field, lion in red, add a crown").
//   1. plan: which new emblems the change needs (search keywords), judged from the spec and a render;
//   2. compose: the revised design, choosing from the current emblems plus the search results;
//   3. check (catalog names, seams) with one repair round.

import type { Catalog } from '../catalog/catalog.ts';
import type { CoatOfArms } from '../coa/model.ts';
import { renderCoa } from '../render/render.ts';
import { checkDesign, designRules, emblemSheet, patternSheet, png, SYSTEM, type Vision } from './design-rules.ts';
import type { JsonRequest, LlmProvider } from './provider.ts';
import { buildEmblemIndex, describeEmblem, searchEmblems, type EmblemDoc } from './search.ts';
import { coaToSpec, DESIGN_SCHEMA, specToCoa, type DesignSpec } from './spec.ts';

export interface RefineOptions {
  coa: CoatOfArms;
  instruction: string;
  /** House name and words, for context. */
  name?: string;
  words?: string;
  vision?: Vision;
  onProgress?: (message: string) => void;
  /** Repair rounds when the revision has problems (default 1). */
  repairRounds?: number;
}

export interface RefineResult {
  coa: CoatOfArms;
  spec: DesignSpec;
  /** What the model changed, in its own words. */
  note: string;
  /** Problems that remained after the repair round. */
  errors: string[];
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    understanding: { type: 'string', description: 'one sentence: what will change' },
    new_motifs: {
      type: 'array',
      description: 'emblems the change needs that the design does not have yet; empty if none',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['charge', 'ordinary', 'secondary'] },
          keywords: { type: 'array', items: { type: 'string' } },
        },
        required: ['role', 'keywords'],
        additionalProperties: false,
      },
    },
  },
  required: ['understanding', 'new_motifs'],
  additionalProperties: false,
};

const REFINE_SCHEMA = {
  type: 'object',
  properties: { design: DESIGN_SCHEMA, note: { type: 'string', description: 'short summary of the changes' } },
  required: ['design', 'note'],
  additionalProperties: false,
};

export async function refineDesign(provider: LlmProvider, catalog: Catalog, options: RefineOptions): Promise<RefineResult> {
  const progress = options.onProgress ?? (() => {});
  const vision = provider.supportsImages ? options.vision : undefined;
  const current = coaToSpec(options.coa);
  const context = [options.name && `House: ${options.name}`, options.words && `Words: "${options.words}"`].filter(Boolean).join('\n');

  const currentImage = vision ? [await png(vision, (await renderCoa(options.coa, vision.ctx, 256)).image)] : [];

  // --- Step 1: plan ---
  progress('Understanding the request');
  const plan = (await provider.generateJson({
    label: 'refine plan',
    system: SYSTEM,
    images: currentImage,
    schema: PLAN_SCHEMA,
    prompt: `${vision ? 'The image shows the current coat of arms.\n' : ''}Current design (layers back to front):
${JSON.stringify(current)}
${context}

Requested change:
"""${options.instruction}"""

List only the NEW emblems this change needs as search keywords (simple English nouns such as crown, tower, wave, bordure, bend;
or a canonical house name when its sigil is meant, e.g. "greyjoy" for a kraken). Recolouring, moving or removing needs none.`,
  })) as { understanding: string; new_motifs: { role: string; keywords: string[] }[] };

  // --- Step 2: candidates = current emblems + search results ---
  const index = buildEmblemIndex(catalog);
  const byName = new Map(index.map((d) => [d.name, d]));
  const candidates: EmblemDoc[] = [];
  const add = (d: EmblemDoc | undefined) => d && !candidates.includes(d) && candidates.push(d);
  current.layers.forEach((l) => add(byName.get(l.texture)));
  const currentCount = candidates.length;
  for (const m of plan.new_motifs) searchEmblems(index, m.keywords, m.role === 'ordinary' ? 8 : 12).forEach((h) => add(h.doc));

  const patternList = [...catalog.assets.pattern.values()].filter((p) => p.visible).map((p) => p.name);
  const images: JsonRequest['images'] = [];
  if (vision) {
    progress('Rendering candidate emblems');
    images.push(await png(vision, await emblemSheet(vision.ctx, candidates.map((c) => c.name))));
    images.push(await png(vision, await patternSheet(vision.ctx, patternList)));
    images.push(...currentImage);
  }
  const list = (docs: EmblemDoc[], offset: number) =>
    docs.map((d, i) => `  - ${vision ? `#${offset + i + 1} ` : ''}${describeEmblem(d)}`).join('\n') || '  (none)';

  const prompt = `Revise this coat of arms according to the request. Change only what the request asks for; keep everything else
(colours, positions, sizes) exactly as it is.
${context}

Requested change:
"""${options.instruction}"""
Your understanding: ${plan.understanding}

Current design (layers back to front):
${JSON.stringify(current)}

Emblems already in the design:
${list(candidates.slice(0, currentCount), 0)}
New candidate emblems:
${list(candidates.slice(currentCount), currentCount)}

${designRules(catalog, patternList, !!vision, 'ONLY emblem file names listed above.')}${vision ? '\n- Image 3 shows the current design.' : ''}`;

  progress('Revising the design');
  const first = (await provider.generateJson({ label: 'refine', system: SYSTEM, images, schema: REFINE_SCHEMA, prompt })) as {
    design: unknown;
    note: string;
  };
  let result = await checkDesign(first.design, catalog, vision);
  let note = first.note;

  // --- Step 3: repair rounds ---
  let attempt = first.design;
  for (let round = 0; round < (options.repairRounds ?? 1) && result.errors.length; round++) {
    progress('Fixing problems');
    const repaired = (await provider.generateJson({
      label: 'refine repair',
      system: SYSTEM,
      images,
      schema: REFINE_SCHEMA,
      prompt: `${prompt}\n\nYour revision has problems:\n${result.errors.map((e) => `- ${e}`).join('\n')}\n\nYour revision: ${JSON.stringify(attempt)}\nReturn the corrected design.`,
    })) as { design: unknown; note: string };
    attempt = repaired.design;
    const fixed = await checkDesign(repaired.design, catalog, vision);
    if (fixed.errors.length <= result.errors.length) {
      result = fixed;
      note = repaired.note;
    }
  }

  // The spec format has no textured emblems or sub-shields; carry them over unchanged.
  const coa = { ...specToCoa(result.spec), texturedEmblems: options.coa.texturedEmblems, subs: options.coa.subs };
  return { coa, spec: result.spec, note, errors: result.errors };
}
