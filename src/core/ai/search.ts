// Keyword search over the emblem catalog. Emblems are only known by file name, so the index combines
// name tokens, the designer category, and which houses already use the emblem.

import type { AssetEntry, Catalog } from '../catalog/catalog.ts';

export interface EmblemDoc {
  name: string;
  tokens: Set<string>;
  category?: string;
  colors?: number;
  mod: string;
  /** Names of houses whose arms use this emblem. */
  usedBy: string[];
  /** Tokens of those house names, so "greyjoy" finds the kraken. */
  houseTokens: Set<string>;
  visible: boolean;
}

/** Heraldic and fantasy synonyms, so a query for "direwolf" also finds "wolf". */
const SYNONYMS: Record<string, string[]> = {
  direwolf: ['wolf'],
  kraken: ['squid', 'octopus'],
  squid: ['kraken'],
  octopus: ['kraken'],
  dragon: ['wyvern', 'drake'],
  wyvern: ['dragon'],
  lion: ['lioness'],
  stag: ['deer', 'hart', 'antler'],
  deer: ['stag', 'hart'],
  boar: ['pig', 'swine'],
  horse: ['stallion', 'mare', 'unicorn'],
  bird: ['eagle', 'falcon', 'hawk', 'raven', 'crow', 'swan', 'heron', 'owl'],
  fish: ['trout', 'pike', 'salmon', 'carp', 'herring'],
  ship: ['boat', 'galley', 'longship', 'cog'],
  sword: ['blade', 'swords'],
  tower: ['castle', 'keep', 'turret'],
  castle: ['tower', 'keep'],
  sun: ['sunburst', 'star'],
  moon: ['crescent'],
  crescent: ['moon'],
  tree: ['oak', 'weirwood', 'pine', 'ash'],
  flower: ['rose', 'lily', 'fleur'],
  rose: ['flower'],
  wave: ['waves', 'water', 'sea', 'nebuly', 'wavy'],
  water: ['wave', 'waves', 'wavy'],
  sea: ['wave', 'waves', 'ship', 'anchor'],
  fire: ['flame', 'flames', 'torch'],
  flame: ['fire', 'flames'],
  skull: ['bones', 'death'],
  crown: ['coronet', 'circlet'],
  key: ['keys'],
  bear: ['ursine'],
  wheat: ['sheaf', 'barley', 'grain'],
};

const STOP = new Set(['ce', 'dds', 'the', 'of', 'and', 'a', 'an', 'agot', 'asoiaf', 'coa']);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\.dds$/, '')
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function buildEmblemIndex(catalog: Catalog): EmblemDoc[] {
  const usedBy = new Map<string, Set<string>>();
  for (const d of catalog.dynasties.values()) {
    const coa = catalog.coas.get(d.key)?.coa;
    for (const e of coa?.coloredEmblems ?? []) {
      const set = usedBy.get(e.texture) ?? new Set();
      set.add(d.name);
      usedBy.set(e.texture, set);
    }
  }
  const docs: EmblemDoc[] = [];
  for (const a of catalog.assets.colored_emblem.values()) {
    if (a.name.startsWith('ce__empty') || a.colors === 0) continue;
    const houses = [...(usedBy.get(a.name) ?? [])];
    const tokens = new Set([...tokenize(a.name), ...(a.category ? tokenize(a.category) : [])]);
    docs.push({
      name: a.name,
      tokens,
      category: a.category,
      colors: a.colors,
      mod: a.file.layer.name,
      usedBy: houses,
      houseTokens: new Set(houses.flatMap(tokenize)),
      visible: a.visible,
    });
  }
  return docs;
}

export interface SearchHit {
  doc: EmblemDoc;
  score: number;
}

/** Keyword tokens plus their heraldic synonyms ("direwolf" → direwolf, wolf). */
export function expandKeywords(keywords: string[]): Set<string> {
  const terms = keywords.flatMap(tokenize);
  return new Set([...terms, ...terms.flatMap((t) => SYNONYMS[t] ?? [])]);
}

/** Rank emblems for a set of keywords. Exact token hits count most, then synonyms, then prefixes. */
export function searchEmblems(index: EmblemDoc[], keywords: string[], limit = 12): SearchHit[] {
  const terms = keywords.flatMap(tokenize);
  const expanded = new Set(terms.flatMap((t) => SYNONYMS[t] ?? []));
  const hits: SearchHit[] = [];
  for (const doc of index) {
    let score = 0;
    for (const t of terms) {
      if (doc.tokens.has(t)) score += 3;
      else if ([...doc.tokens].some((d) => d.length > 3 && t.length > 3 && (d.startsWith(t) || t.startsWith(d)))) score += 1.5;
    }
    for (const t of expanded) if (doc.tokens.has(t)) score += 1.5;
    for (const t of terms) if (!doc.tokens.has(t) && doc.houseTokens.has(t)) score += 2;
    if (score === 0) continue;
    // Prefer emblems the designer lists and that real houses use, as a weak quality signal. Kept small, so that
    // equally good matches get a chance instead of the same popular emblems every time.
    if (doc.visible) score += 0.3;
    score += Math.min(doc.usedBy.length, 5) * 0.03;
    hits.push({ doc, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.doc.name.localeCompare(b.doc.name)).slice(0, limit);
}

/** One line per emblem for prompts: name, colours, category, and houses that use it. */
export function describeEmblem(doc: EmblemDoc | AssetEntry & { usedBy?: string[] }): string {
  const parts = [doc.name];
  if (doc.colors) parts.push(`${doc.colors} colour${doc.colors > 1 ? 's' : ''}`);
  if (doc.category) parts.push(doc.category);
  const used = doc.usedBy ?? [];
  if (used.length) parts.push(`used by ${used.slice(0, 4).join(', ')}${used.length > 4 ? ` +${used.length - 4}` : ''}`);
  return parts.join(' | ');
}
