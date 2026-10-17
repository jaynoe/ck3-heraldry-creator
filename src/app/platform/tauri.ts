// Platform for the native Tauri app; talks to the Rust commands in src-tauri/src/lib.rs.

import { invoke } from '@tauri-apps/api/core';
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { ProviderError, type JsonRequest, type LlmProvider } from '../../core/ai/provider.ts';
import type { HostResponse } from '../../core/ai/providers/types.ts';
import { joinPath, type DirEntry, type FileSource } from '../../core/fs/types.ts';
import { jsonLibrary } from '../../core/library.ts';
import { readPlaysets, type Playset } from '../../core/mods/playsets.ts';
import type { Platform } from './types.ts';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

interface Paths {
  game: string;
  workshop: string;
  user: string;
  gameVersion: string;
}

class TauriFileSource implements FileSource {
  constructor(
    private root: string,
    readonly label: string,
  ) {}

  list(dir: string): Promise<DirEntry[]> {
    return invoke<DirEntry[]>('fs_list', { path: joinPath(this.root, dir) });
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await invoke<ArrayBuffer>('fs_read', { path: joinPath(this.root, path) }));
    } catch {
      return undefined;
    }
  }
}

const claudeProvider: LlmProvider = {
  id: 'claude-cli',
  supportsImages: true,
  async generateJson(req: JsonRequest) {
    try {
      return await invoke('claude_json', { request: req });
    } catch (e) {
      throw new ProviderError(`${req.label}: ${String(e)}`);
    }
  },
};

const library = jsonLibrary(
  () => invoke<string>('library_load'),
  (json) => invoke('library_save', { json }),
);

let pathsPromise: Promise<Paths> | undefined;
const paths = () => (pathsPromise ??= invoke<Paths>('default_paths'));

export async function createTauriPlatform(): Promise<Platform> {
  const hasClaude = await invoke<boolean>('claude_available');
  return {
    name: 'tauri',
    cliProvider: hasClaude ? claudeProvider : undefined,
    library,
    async hostFetch(provider, url, init) {
      try {
        return await invoke<HostResponse>('host_fetch', { provider, url, method: init.method, headers: init.headers, body: init.body ?? null });
      } catch (e) {
        throw new ProviderError(String(e));
      }
    },
    keys: {
      status: () => invoke<Record<string, boolean>>('keys_status'),
      set: (provider, key) => invoke('key_set', { provider, key }),
      remove: (provider) => invoke('key_delete', { provider }),
    },
    cache: {
      get: async (key) => (await invoke<string | null>('cache_get', { key })) ?? undefined,
      set: (key, value) => invoke('cache_set', { key, value }),
    },
    gameVersion: async () => (await paths()).gameVersion,
    // The opener capability only allows AWOIAF and this repo's new-issue form.
    openUrl: (url) => openUrl(url),
    buildKind: async () => (await invoke<string | null>('build_kind')) ?? undefined,
    async checkUpdate() {
      const update = await check();
      if (!update) return undefined;
      // The updater replaces an AppImage or runs the Windows installer; .deb and .rpm belong to the package manager.
      const kind = (await invoke<string | null>('build_kind')) ?? '';
      const selfUpdating = kind === 'Linux · AppImage' || kind.startsWith('Windows');
      return {
        version: update.version,
        url: `https://github.com/jaynoe/ck3-heraldry-creator/releases/tag/v${update.version}`,
        install: selfUpdating
          ? async (onProgress) => {
              let total = 0;
              let done = 0;
              await update.downloadAndInstall((e) => {
                if (e.event === 'Started') total = e.data.contentLength ?? 0;
                if (e.event === 'Progress') done += e.data.chunkLength;
                onProgress(total ? Math.round((done / total) * 100) : undefined);
              });
              await relaunch();
            }
          : undefined,
      };
    },
    wikiQuery: async (params) => JSON.parse(await invoke<string>('awoiaf_query', { params })),

    async loadPlaysets(): Promise<Playset[]> {
      const p = await paths();
      if (!p.game) throw new Error('Crusader Kings III was not found in any Steam library.');
      const db = await new TauriFileSource(p.user, 'Paradox').read('launcher-v2.sqlite');
      if (!db) throw new Error(`launcher-v2.sqlite not found in ${p.user}`);
      const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
      return readPlaysets(SQL, db);
    },

    async playsetSources(playset) {
      const p = await paths();
      return {
        game: new TauriFileSource(p.game, 'Crusader Kings III'),
        mods: playset.mods.flatMap((m) => {
          const dir = m.dirPath ?? (m.steamId ? joinPath(p.workshop, m.steamId) : undefined);
          return dir ? [{ id: m.id, name: m.displayName, source: new TauriFileSource(dir, m.displayName) }] : [];
        }),
      };
    },
  };
}

export const isTauri = () => '__TAURI_INTERNALS__' in window;
