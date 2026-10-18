// Real AGOT arms as examples for the model. Most house arms in the mod are a single charge on a plain field,
// so examples taken at random teach the model to be plain. These helpers pick the arms that share motifs
// with the design directions and are well composed, and find the houses an idea names (a marriage of
// Clegane and Stark should combine their arms).

import type { Catalog, Dynasty } from '../catalog/catalog.ts';
import type { CoatOfArms } from '../coa/model.ts';
import { expandKeywords, tokenize } from './search.ts';

export interface ExampleArms {
  dynasty: Dynasty;
  coa: CoatOfArms;
}

const SOLID = 'pattern_solid.dds';

/** How much a design does: repeated charges, several layers and a divided field count; clutter does not. */
export function richness(coa: CoatOfArms): number {
  const instances = coa.coloredEmblems.reduce((n, e) => n + Math.max(1, e.instances.length), 0);
  const layers = new Set(coa.coloredEmblems.map((e) => e.texture)).size;
  const divided = coa.pattern && coa.pattern !== SOLID ? 1 : 0;
  // Beyond about eight pieces a design gets busy rather than better.
  return Math.min(layers, 4) * 0.8 + Math.min(instances, 8) * 0.3 + divided * 1.2 - Math.max(0, instances - 10) * 0.2;
}

/**
 * Up to `count` house arms for the prompt: sharing motifs with `keywords` counts most, then a well-composed
 * design, then the region. No two examples share their main emblem, so the set shows different ideas.
 */
export function exampleArms(catalog: Catalog, o: { keywords: string[]; region?: string; exclude?: string[]; count?: number }): ExampleArms[] {
  const terms = expandKeywords(o.keywords);
  const exclude = new Set(o.exclude ?? []);
  const scored: { ex: ExampleArms; score: number; main: string }[] = [];
  for (const dynasty of catalog.dynasties.values()) {
    const coa = catalog.coas.get(dynasty.key)?.coa;
    if (!coa || exclude.has(dynasty.key) || !coa.coloredEmblems.length) continue;
    const tokens = new Set(coa.coloredEmblems.flatMap((e) => tokenize(e.texture)));
    const motif = [...terms].filter((t) => tokens.has(t)).length;
    const score = motif * 3 + richness(coa) + (dynasty.group === o.region ? 1 : 0);
    scored.push({ ex: { dynasty, coa }, score, main: coa.coloredEmblems.at(-1)!.texture });
  }
  scored.sort((a, b) => b.score - a.score || a.ex.dynasty.key.localeCompare(b.ex.dynasty.key));
  const picked: ExampleArms[] = [];
  const mains = new Set<string>();
  for (const s of scored) {
    if (mains.has(s.main)) continue;
    mains.add(s.main);
    picked.push(s.ex);
    if (picked.length >= (o.count ?? 4)) break;
  }
  return picked;
}

/**
 * Houses the idea names, e.g. "Sandor Clegane marries Sansa Stark" → Clegane, Stark. Only capitalised whole
 * words count (also as plural or possessive: "the Starks", "Stark's"), because many house names are also
 * plain words ("hunters", "crane"). Main dynasties win over cadet houses of the same name.
 */
export function mentionedHouses(catalog: Catalog, text: string, max = 4): ExampleArms[] {
  const byName = new Map<string, ExampleArms>();
  for (const dynasty of catalog.dynasties.values()) {
    const coa = catalog.coas.get(dynasty.key)?.coa;
    if (!coa || dynasty.name.length < 4 || !/^[A-Z][a-z]+$/.test(dynasty.name)) continue;
    const known = byName.get(dynasty.name);
    if (!known || (known.dynasty.dynasty && !dynasty.dynasty)) byName.set(dynasty.name, { dynasty, coa });
  }
  const found: { ex: ExampleArms; at: number }[] = [];
  for (const [name, ex] of byName) {
    const at = text.search(new RegExp(`(?<![A-Za-z])${name}(?:s|'s)?(?![A-Za-z])`));
    if (at >= 0) found.push({ ex, at });
  }
  return found.sort((a, b) => a.at - b.at).slice(0, max).map((f) => f.ex);
}
