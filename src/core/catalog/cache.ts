// Saves a built catalog so a playset loads instantly next time. The cache is never refreshed
// automatically: the UI compares fingerprints and offers a "re-read game files" button instead.

import type { CoatOfArms, ColorValue } from '../coa/model.ts';
import type { Layer, LayeredFile } from '../fs/layered.ts';
import type { Playset } from '../mods/playsets.ts';
import type { AssetEntry, AssetKind, Bookmark, Catalog, CoaDefinition, Dynasty, GameRule } from './catalog.ts';

/** Bump when the cached shape or the catalog building logic changes. */
export const CACHE_FORMAT = 5; // 2: distrobox mod-read fix; 3: bookmarks and game rules; 4: dynasty houses; 5: culture CoA frames

type FileRef = [layerId: string, path: string];

export interface CachedCatalog {
  format: number;
  fingerprint: string;
  createdAt: string;
  playsetName: string;
  assets: Record<AssetKind, (Omit<AssetEntry, 'file'> & { file: FileRef })[]>;
  namedColors: [string, ColorValue][];
  designerColors: string[];
  coas: [string, CoatOfArms, FileRef][];
  dynasties: (Omit<Dynasty, 'file'> & { file: FileRef })[];
  bookmarks: Bookmark[];
  gameRules: GameRule[];
  cultureFrames: [string, string][];
}

export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/** Changes whenever the game version, the playset's mods, their order or their versions change. */
export function playsetFingerprint(playset: Playset, gameVersion: string): string {
  const mods = playset.mods.map((m) => `${m.id}@${m.version ?? ''}:${m.timeUpdated ?? ''}`).join('|');
  return `${CACHE_FORMAT};${gameVersion};${mods}`;
}

export const cacheKey = (playset: Playset) => `catalog-${playset.id.replace(/[^A-Za-z0-9-]/g, '')}`;

const ref = (f: LayeredFile): FileRef => [f.layer.id, f.path];

export function serializeCatalog(catalog: Catalog, fingerprint: string, playsetName: string): CachedCatalog {
  const assets = {} as CachedCatalog['assets'];
  for (const [kind, map] of Object.entries(catalog.assets) as [AssetKind, Map<string, AssetEntry>][]) {
    assets[kind] = [...map.values()].map((a) => ({ ...a, file: ref(a.file) }));
  }
  return {
    format: CACHE_FORMAT,
    fingerprint,
    createdAt: new Date().toISOString(),
    playsetName,
    assets,
    namedColors: [...catalog.namedColors],
    designerColors: catalog.designerColors,
    coas: [...catalog.coas.values()].map((c) => [c.key, c.coa, ref(c.file)]),
    dynasties: [...catalog.dynasties.values()].map((d) => ({ ...d, file: ref(d.file) })),
    bookmarks: catalog.bookmarks,
    gameRules: catalog.gameRules,
    cultureFrames: [...catalog.cultureFrames],
  };
}

/** Rebuild a catalog against the current layers. Entries whose layer is gone are dropped. */
export function deserializeCatalog(data: CachedCatalog, layers: readonly Layer[]): Catalog | undefined {
  if (data.format !== CACHE_FORMAT) return undefined;
  const byId = new Map(layers.map((l) => [l.id, l]));
  const file = ([id, path]: FileRef): LayeredFile | undefined => {
    const layer = byId.get(id);
    return layer && { path, layer };
  };
  const assets = {} as Catalog['assets'];
  for (const [kind, list] of Object.entries(data.assets) as [AssetKind, CachedCatalog['assets'][AssetKind]][]) {
    assets[kind] = new Map(list.flatMap((a) => {
      const f = file(a.file);
      return f ? [[a.name, { ...a, file: f }] as const] : [];
    }));
  }
  const coas = new Map<string, CoaDefinition>(
    data.coas.flatMap(([key, coa, r]) => {
      const f = file(r);
      return f ? [[key, { key, coa, file: f }] as const] : [];
    }),
  );
  const dynasties = new Map<string, Dynasty>(
    data.dynasties.flatMap((d) => {
      const f = file(d.file);
      return f ? [[d.key, { ...d, file: f }] as const] : [];
    }),
  );
  return {
    assets,
    namedColors: new Map(data.namedColors),
    designerColors: data.designerColors,
    coas,
    dynasties,
    bookmarks: data.bookmarks,
    gameRules: data.gameRules,
    cultureFrames: new Map(data.cultureFrames),
    // Only needed while building (dynasty names and words are already resolved).
    localization: new Map(),
  };
}
