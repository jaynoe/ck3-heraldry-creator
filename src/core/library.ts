// The user's Collection: saved coats of arms and saved run ideas. Stored by the platform as one
// JSON file in the user's data folder; entries without `kind` are arms (files from before ideas existed).

import type { IdeaSnapshot } from './ai/inspire.ts';

export interface SavedCoa {
  kind?: 'arms';
  id: string;
  name: string;
  words?: string;
  /** The idea the design was generated from, if any. */
  idea?: string;
  region?: string;
  /** Dynasty key of the parent house for cadet branches. */
  parent?: string;
  /** CoA script in the in-game designer's clipboard format; the source of truth. */
  script: string;
  /** Playset the design was made with; its mods must be loaded for the emblems to show in game. */
  playset?: string;
  createdAt: string;
}

/** A run idea from the Citadel, saved as a snapshot so it stays readable with any playset. */
export interface SavedIdea {
  kind: 'idea';
  id: string;
  idea: IdeaSnapshot;
  /** Playset the idea was made for. */
  playset?: string;
  createdAt: string;
}

export type LibraryItem = SavedCoa | SavedIdea;

export const isIdea = (item: LibraryItem): item is SavedIdea => item.kind === 'idea';

export interface LibraryStore {
  list(): Promise<LibraryItem[]>;
  save(item: LibraryItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * A LibraryStore over one JSON file the host reads and writes as a whole. Changes run one after the
 * other, so two quick saves cannot both read the old list and drop each other's entry.
 */
export function jsonLibrary(load: () => Promise<string>, store: (json: string) => Promise<void>): LibraryStore {
  return jsonStore<LibraryItem>(load, store);
}

/** The same for any list of items with an id; the newest save comes first. */
export function jsonStore<T extends { id: string }>(load: () => Promise<string>, store: (json: string) => Promise<void>) {
  let queue: Promise<unknown> = Promise.resolve();
  const list = async () => JSON.parse(await load()) as T[];
  const change = (update: (items: T[]) => T[]) => {
    const run = queue.then(async () => store(JSON.stringify(update(await list()), null, 2)));
    queue = run.catch(() => {});
    return run;
  };
  return {
    list,
    save: (item: T) => change((items) => [item, ...items.filter((i) => i.id !== item.id)]),
    remove: (id: string) => change((items) => items.filter((i) => i.id !== id)),
  };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The text behind saved arms, split up for reading. */
export interface HouseStory {
  title?: string;
  lead: string;
  start?: string;
  catch?: string;
  details: { label: string; text: string }[];
}

const COPIED_LINE = /^(Start|House|Canon|Concept|Why it fits|Game rule|Sigil|Catch|Sources[^:]*): (.*)$/;
const DETAIL_LABELS: Record<string, string> = { Canon: 'Canon', 'Why it fits': 'Why it fits', 'Game rule': 'Game rules', Sigil: 'Sigil & words' };

/**
 * Saved arms keep their idea as one text: a copied idea (`ideaToText`), a generated one (`ideaToHouseIdea`) or
 * whatever the user typed. Anything that fits neither form stays whole as the lead.
 */
export function houseStory(text: string): HouseStory {
  const all = text.trim();
  if (all.startsWith('## ')) {
    const [first, ...lines] = all.split('\n');
    const fields = new Map<string, string[]>();
    let last: string[] | undefined;
    for (const line of lines) {
      const m = COPIED_LINE.exec(line);
      if (m) {
        const key = m[1]!.startsWith('Sources') ? 'Sources' : m[1]!;
        last = fields.get(key) ?? [];
        fields.set(key, last);
        last.push(m[2]!);
      } else if (line.trim()) last?.push(line.trim());
    }
    const lead = fields.get('Concept')?.join('\n');
    if (lead) {
      return {
        title: first!.slice(3).trim(),
        lead,
        start: fields.get('Start')?.join('\n').replace(/^free start date\.\s*/, ''),
        catch: fields.get('Catch')?.join('\n'),
        details: Object.entries(DETAIL_LABELS).flatMap(([key, label]) => (fields.has(key) ? [{ label, text: fields.get(key)!.join('\n') }] : [])),
      };
    }
    return { lead: all, details: [] };
  }
  const marks = [...all.matchAll(/\s(Start|Sigil direction|Words direction): /g)];
  if (!marks.length) return { lead: all, details: [] };
  const part = (i: number) => all.slice(marks[i]!.index + marks[i]![0].length, marks[i + 1]?.index ?? all.length).trim().replace(/\.+$/, '');
  const head = /^([^.]{3,80})\.\s+([\s\S]+)$/.exec(all.slice(0, marks[0]!.index).trim());
  const found = marks.map((m, i) => ({ label: m[1]!, text: part(i) }));
  return {
    title: head?.[1],
    lead: head?.[2] ?? all.slice(0, marks[0]!.index).trim(),
    start: found.find((f) => f.label === 'Start')?.text,
    details: found.filter((f) => f.label !== 'Start'),
  };
}
