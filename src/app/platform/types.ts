// What the UI needs from its host. The dev server (browser) and Tauri each implement this,
// so the UI and everything in src/core stay identical across both.

import type { LlmProvider } from '../../core/ai/provider.ts';
import type { HostFetch, ProviderId } from '../../core/ai/providers/types.ts';
import type { CacheStore } from '../../core/catalog/cache.ts';
import type { FileSource } from '../../core/fs/types.ts';
import type { LibraryStore } from '../../core/library.ts';
import type { WikiQuery } from '../../core/ai/canon.ts';
import type { Playset } from '../../core/mods/playsets.ts';
import type { ModSource } from '../../core/session.ts';

/** A newer release than the running one. */
export interface AvailableUpdate {
  version: string;
  /** Release page, for builds the app cannot update itself (.deb, .rpm). */
  url: string;
  /** Downloads, verifies and installs the update, then restarts the app; missing where the package manager owns the app. */
  install?: (onProgress: (percent: number | undefined) => void) => Promise<void>;
}

export interface Platform {
  readonly name: string;
  loadPlaysets(): Promise<Playset[]>;
  /** File sources for the game and the enabled mods of a playset, in load order. */
  playsetSources(playset: Playset): Promise<{ game: FileSource; mods: ModSource[] }>;
  /** The local Claude Code CLI, when installed. */
  cliProvider?: LlmProvider;
  /** HTTP for bring-your-own-key providers; the host adds the stored key. */
  hostFetch: HostFetch;
  /** API keys live in the host (OS keychain in the desktop app); the page can only set or remove them. */
  keys: {
    status(): Promise<Partial<Record<ProviderId, boolean>>>;
    set(provider: ProviderId, key: string): Promise<void>;
    remove(provider: ProviderId): Promise<void>;
  };
  library: LibraryStore;
  /** Stores built catalogs per playset (the user's cache folder). */
  cache: CacheStore;
  /** Installed CK3 version, part of the cache fingerprint ('' if unknown). */
  gameVersion(): Promise<string>;
  /** Opens a source link (A Wiki of Ice and Fire) or the test report form in the user's browser. */
  openUrl(url: string): Promise<void>;
  /** Read-only query to A Wiki of Ice and Fire, sent by the host with an identifying User-Agent. */
  wikiQuery: WikiQuery;
  /** The running release bundle as named in the test report form ("Linux · AppImage"), if known. */
  buildKind(): Promise<string | undefined>;
  /** Looks for a newer release on GitHub; only the desktop app has it. */
  checkUpdate?: () => Promise<AvailableUpdate | undefined>;
}
