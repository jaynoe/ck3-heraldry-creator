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

/** A run idea from Inspiration, saved as a snapshot so it stays readable with any playset. */
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
  let queue: Promise<unknown> = Promise.resolve();
  const list = async () => JSON.parse(await load()) as LibraryItem[];
  const change = (update: (items: LibraryItem[]) => LibraryItem[]) => {
    const run = queue.then(async () => store(JSON.stringify(update(await list()), null, 2)));
    queue = run.catch(() => {});
    return run;
  };
  return {
    list,
    save: (item) => change((items) => [item, ...items.filter((i) => i.id !== item.id)]),
    remove: (id) => change((items) => items.filter((i) => i.id !== id)),
  };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
