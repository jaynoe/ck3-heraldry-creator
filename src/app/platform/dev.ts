// Platform for `npm run dev`: talks to the Vite dev-server plugin in dev/api-plugin.ts.

import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { ProviderError, type JsonRequest, type LlmProvider } from '../../core/ai/provider.ts';
import type { HostResponse } from '../../core/ai/providers/types.ts';
import { joinPath } from '../../core/fs/types.ts';
import { jsonLibrary } from '../../core/library.ts';
import { readPlaysets, type Playset } from '../../core/mods/playsets.ts';
import { HttpFileSource } from './http-fs.ts';
import type { Platform } from './types.ts';

interface Paths {
  game: string;
  workshop: string;
  user: string;
  gameVersion: string;
}

const devProvider: LlmProvider = {
  id: 'claude-cli (dev server)',
  supportsImages: true,
  async generateJson(req: JsonRequest) {
    const res = await fetch('/api/llm', { method: 'POST', body: JSON.stringify(req) });
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok || data.error) throw new ProviderError(data.error ?? `HTTP ${res.status}`);
    return data.result;
  },
};

const library = jsonLibrary(
  async () => {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Loading the library failed');
    return res.text();
  },
  async (json) => {
    const res = await fetch('/api/library', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: json });
    if (!res.ok) throw new Error('Saving the library failed');
  },
);

let pathsPromise: Promise<Paths> | undefined;
const paths = () => (pathsPromise ??= fetch('/api/paths').then((r) => r.json() as Promise<Paths>));

export const devPlatform: Platform = {
  name: 'dev server',
  cliProvider: devProvider,
  library,
  async hostFetch(provider, url, init) {
    const res = await fetch('/api/http', { method: 'POST', body: JSON.stringify({ provider, url, ...init }) });
    const data = (await res.json()) as HostResponse & { error?: string };
    if (data.error) throw new ProviderError(data.error);
    return data;
  },
  keys: {
    status: async () => (await (await fetch('/api/keys')).json()) as Record<string, boolean>,
    async set(provider, key) {
      await fetch('/api/keys', { method: 'PUT', body: JSON.stringify({ provider, key }) });
    },
    async remove(provider) {
      await fetch(`/api/keys?provider=${provider}`, { method: 'DELETE' });
    },
  },
  cache: {
    async get(key) {
      const res = await fetch(`/api/cache?key=${encodeURIComponent(key)}`);
      return res.ok ? res.text() : undefined;
    },
    async set(key, value) {
      await fetch(`/api/cache?key=${encodeURIComponent(key)}`, { method: 'PUT', body: value });
    },
  },
  gameVersion: async () => (await paths()).gameVersion,
  wikiQuery: async (params) => {
    const res = await fetch(`/api/awoiaf?${new URLSearchParams(params)}`);
    const data = (await res.json()) as { error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  },
  openUrl: async (url) => {
    window.open(url, '_blank', 'noopener');
  },
  buildKind: async () => undefined,

  async loadPlaysets(): Promise<Playset[]> {
    const { user } = await paths();
    const db = await new HttpFileSource(user, 'Paradox').read('launcher-v2.sqlite');
    if (!db) throw new Error(`launcher-v2.sqlite not found in ${user}`);
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
    return readPlaysets(SQL, db);
  },

  async playsetSources(playset) {
    const p = await paths();
    return {
      game: new HttpFileSource(p.game, 'Crusader Kings III'),
      mods: playset.mods.flatMap((m) => {
        const dir = m.dirPath ?? (m.steamId ? joinPath(p.workshop, m.steamId) : undefined);
        return dir ? [{ id: m.id, name: m.displayName, source: new HttpFileSource(dir, m.displayName) }] : [];
      }),
    };
  },
};
