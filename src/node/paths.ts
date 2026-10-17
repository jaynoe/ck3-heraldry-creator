// Default install locations per OS, plus helpers to open a playset from the local machine.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { readPlaysets, type Playset } from '../core/mods/playsets.ts';
import { createLayers, HeraldrySession } from '../core/session.ts';
import { NodeFileSource } from './node-fs.ts';

export interface LocalPaths {
  game: string;
  workshop: string;
  /** Paradox user folder holding launcher-v2.sqlite and local mods. */
  user: string;
}

export function defaultPaths(): LocalPaths {
  const home = homedir();
  const steam =
    process.env.STEAM_ROOT ??
    {
      linux: join(home, '.local/share/Steam'),
      win32: 'C:/Program Files (x86)/Steam',
      darwin: join(home, 'Library/Application Support/Steam'),
    }[platform() as string] ??
    join(home, '.local/share/Steam');
  const user =
    process.env.CK3_USER_DIR ??
    (platform() === 'linux'
      ? join(home, '.local/share/Paradox Interactive/Crusader Kings III')
      : join(home, 'Documents/Paradox Interactive/Crusader Kings III'));
  return {
    game: process.env.CK3_GAME_DIR ?? join(steam, 'steamapps/common/Crusader Kings III/game'),
    workshop: join(steam, 'steamapps/workshop/content/1158310'),
    user,
  };
}

export async function loadPlaysets(paths = defaultPaths()): Promise<Playset[]> {
  const SQL = await initSqlJs();
  return readPlaysets(SQL, new Uint8Array(await readFile(join(paths.user, 'launcher-v2.sqlite'))));
}

/** Find a playset by (case-insensitive, trimmed) name, or the active one. */
export function pickPlayset(playsets: Playset[], name?: string): Playset {
  const p = name
    ? playsets.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    : playsets.find((x) => x.isActive);
  if (!p) throw new Error(name ? `No playset named "${name}"` : 'No active playset');
  return p;
}

export async function openSession(playset: Playset, paths = defaultPaths()): Promise<HeraldrySession> {
  const mods = playset.mods.flatMap((m) => {
    const dir =
      m.dirPath && existsSync(m.dirPath) ? m.dirPath : m.steamId ? join(paths.workshop, m.steamId) : undefined;
    if (!dir || !existsSync(dir)) {
      console.warn(`Mod not found on disk: ${m.displayName}`);
      return [];
    }
    return [{ id: m.id, name: m.displayName, source: new NodeFileSource(dir, m.displayName) }];
  });
  const layers = await createLayers(new NodeFileSource(paths.game, 'Crusader Kings III'), mods);
  return HeraldrySession.open(layers);
}
