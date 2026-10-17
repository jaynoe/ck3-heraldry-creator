// Vite dev-server plugin: gives the browser app what the Tauri shell will provide natively —
// read-only access to the game, workshop and Paradox user folders, the local Claude CLI, and the
// library file. Only active in `vite dev`, which listens on localhost.

import { chmod, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { JsonRequest } from '../src/core/ai/provider.ts';
import type { LibraryItem } from '../src/core/library.ts';
import { defaultPaths } from '../src/node/paths.ts';
import { ClaudeCliProvider } from '../src/node/providers/claude-cli.ts';
import { fetchWikiQuery } from '../src/core/ai/canon.ts';

const wikiQuery = fetchWikiQuery((url, init) => fetch(url, init));

const libraryFile = join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'ck3-heraldry-creator', 'library.json');
const cacheDir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ck3-heraldry-creator');

// Dev-only key store. The desktop app uses the OS keychain instead.
const keysFile = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ck3-heraldry-creator', 'dev-keys.json');

async function readKeys(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(keysFile, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeKeys(keys: Record<string, string>) {
  await mkdir(dirname(keysFile), { recursive: true });
  await writeFile(keysFile, JSON.stringify(keys));
  await chmod(keysFile, 0o600);
}

/** Where each provider may send requests, and how its key is attached (same rules as src-tauri). */
const PROVIDER_HOSTS: Record<string, { prefixes: RegExp; auth?: (key: string) => [string, string] }> = {
  anthropic: { prefixes: /^https:\/\/api\.anthropic\.com\//, auth: (k) => ['x-api-key', k] },
  openai: { prefixes: /^https:\/\/api\.openai\.com\//, auth: (k) => ['authorization', `Bearer ${k}`] },
  openrouter: { prefixes: /^https:\/\/openrouter\.ai\/api\//, auth: (k) => ['authorization', `Bearer ${k}`] },
  gemini: { prefixes: /^https:\/\/generativelanguage\.googleapis\.com\//, auth: (k) => ['x-goog-api-key', k] },
  ollama: { prefixes: /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\// },
};

async function gameVersion(game: string): Promise<string> {
  try {
    const settings = JSON.parse(await readFile(join(game, '../launcher/launcher-settings.json'), 'utf8')) as { rawVersion?: string };
    return settings.rawVersion ?? '';
  } catch {
    return '';
  }
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

/** Only a missing file is an empty library; anything else is an error, so a save cannot overwrite it. */
async function readLibrary(): Promise<LibraryItem[]> {
  try {
    return JSON.parse(await readFile(libraryFile, 'utf8')) as LibraryItem[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`cannot read ${libraryFile}: ${(e as Error).message}`);
  }
}

/** Temporary file plus rename, so a crash never leaves a half-written file. */
async function writeAtomic(file: string, data: string | Buffer) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, data);
  await rename(`${file}.tmp`, file);
}

/**
 * Other websites open in the same browser must not use this API (it runs the Claude CLI and uses
 * the stored keys). Browsers mark cross-site requests; only same-origin ones get through.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

export function devApi(): Plugin {
  const paths = defaultPaths();
  // Everything the app may read lives below these folders (local mods are under the user folder).
  // Folders are compared by identity (device + inode), not by path text: the same folder can be
  // reachable under several paths, e.g. /home and /var/home are separate bind mounts in a distrobox.
  const real = (p: string) => realpath(p).catch(() => resolve(p));
  const id = async (p: string) => {
    const s = await stat(p);
    return `${s.dev}:${s.ino}`;
  };
  const roots = Promise.all([paths.game, paths.workshop, paths.user].map((p) => id(p).catch(() => '')));
  const allowed = async (p: string) => {
    const rootIds = new Set((await roots).filter(Boolean));
    for (let dir = p; ; dir = dirname(dir)) {
      if (rootIds.has(await id(dir).catch(() => ''))) return true;
      if (dirname(dir) === dir) return false;
    }
  };
  const claude = new ClaudeCliProvider();

  return {
    name: 'heraldry-dev-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        try {
          if (!sameOrigin(req)) return json(res, { error: 'cross-site request refused' }, 403);
          const url = new URL(req.url ?? '/', 'http://localhost');
          const target = url.searchParams.get('path');
          const abs = target ? await real(target) : '';

          if (url.pathname === '/paths') return json(res, { ...paths, gameVersion: await gameVersion(paths.game) });

          if (url.pathname === '/cache') {
            const key = (url.searchParams.get('key') ?? '').replace(/[^A-Za-z0-9-]/g, '');
            if (!key) return json(res, { error: 'bad key' }, 400);
            const file = join(cacheDir, `${key}.json`);
            if (req.method === 'GET') {
              try {
                res.setHeader('Content-Type', 'application/json');
                return res.end(await readFile(file));
              } catch {
                res.statusCode = 404;
                return res.end();
              }
            }
            if (req.method === 'PUT') {
              await writeAtomic(file, await body(req));
              return json(res, { ok: true });
            }
          }

          if (url.pathname === '/fs/list') {
            if (!(await allowed(abs))) return json(res, { error: 'forbidden' }, 403);
            try {
              const entries = await readdir(abs, { withFileTypes: true });
              return json(res, entries.map((e) => ({ name: e.name, isDir: e.isDirectory() })));
            } catch {
              return json(res, []);
            }
          }

          if (url.pathname === '/fs/read') {
            if (!(await allowed(abs))) return json(res, { error: 'forbidden' }, 403);
            try {
              const data = await readFile(abs);
              res.setHeader('Content-Type', 'application/octet-stream');
              return res.end(data);
            } catch {
              res.statusCode = 404;
              return res.end();
            }
          }

          if (url.pathname === '/llm' && req.method === 'POST') {
            const request = JSON.parse(await body(req)) as JsonRequest;
            try {
              return json(res, { result: await claude.generateJson(request) });
            } catch (e) {
              return json(res, { error: (e as Error).message }, 502);
            }
          }

          if (url.pathname === '/keys') {
            const keys = await readKeys();
            if (req.method === 'GET') return json(res, Object.fromEntries(Object.entries(PROVIDER_HOSTS).filter(([, r]) => r.auth).map(([p]) => [p, !!keys[p]])));
            if (req.method === 'PUT') {
              const { provider, key } = JSON.parse(await body(req)) as { provider: string; key: string };
              if (!PROVIDER_HOSTS[provider]?.auth) return json(res, { error: 'unknown provider' }, 400);
              await writeKeys({ ...keys, [provider]: key.trim() });
              return json(res, { ok: true });
            }
            if (req.method === 'DELETE') {
              delete keys[url.searchParams.get('provider') ?? ''];
              await writeKeys(keys);
              return json(res, { ok: true });
            }
          }

          if (url.pathname === '/http' && req.method === 'POST') {
            const r = JSON.parse(await body(req)) as { provider: string; url: string; method: string; headers: Record<string, string>; body?: string };
            const rule = PROVIDER_HOSTS[r.provider];
            if (!rule || !rule.prefixes.test(r.url)) return json(res, { error: `URL not allowed for ${r.provider}` }, 403);
            const headers = Object.fromEntries(
              Object.entries(r.headers).filter(([k]) => !['x-api-key', 'authorization', 'x-goog-api-key', 'host', 'content-length'].includes(k.toLowerCase())),
            );
            if (rule.auth) {
              const key = (await readKeys())[r.provider];
              if (!key) return json(res, { error: `No API key saved for ${r.provider}` }, 400);
              const [h, v] = rule.auth(key);
              headers[h] = v;
            }
            const upstream = await fetch(r.url, { method: r.method, headers, body: r.body });
            return json(res, { status: upstream.status, headers: Object.fromEntries(upstream.headers.entries()), body: await upstream.text() });
          }

          // A Wiki of Ice and Fire: read-only queries with an identifying User-Agent (see core/ai/canon.ts).
          if (url.pathname === '/awoiaf' && req.method === 'GET') {
            try {
              return json(res, await wikiQuery(Object.fromEntries(url.searchParams)));
            } catch (e) {
              return json(res, { error: (e as Error).message }, 502);
            }
          }

          if (url.pathname === '/library') {
            if (req.method === 'GET') return json(res, await readLibrary());
            if (req.method === 'PUT') {
              const items = JSON.parse(await body(req)) as LibraryItem[];
              await writeAtomic(libraryFile, JSON.stringify(items, null, 2));
              return json(res, { ok: true });
            }
          }

          json(res, { error: 'not found' }, 404);
        } catch (e) {
          json(res, { error: (e as Error).message }, 500);
        }
      });
    },
  };
}
