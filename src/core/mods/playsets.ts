// Reads playsets from the Paradox launcher database (`launcher-v2.sqlite`).
// sql.js is injected so Node and the browser can each load its WASM their own way.

import type { SqlJsStatic } from 'sql.js';

export interface PlaysetMod {
  /** Launcher mod id (uuid). */
  id: string;
  displayName: string;
  steamId?: string;
  source: 'steam' | 'local' | string;
  /** Absolute path on the machine that wrote the database. */
  dirPath?: string;
  /** Load position; later mods override earlier ones. */
  position: number;
  version?: string;
  /** Workshop update time (unix seconds); used to notice mod updates. */
  timeUpdated?: number;
}

export interface Playset {
  id: string;
  name: string;
  isActive: boolean;
  /** Enabled mods in load order. */
  mods: PlaysetMod[];
}

export function readPlaysets(SQL: SqlJsStatic, dbBytes: Uint8Array): Playset[] {
  const db = new SQL.Database(dbBytes);
  try {
    const rows = <T>(sql: string, params: (string | number)[] = []): T[] => {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      stmt.free();
      return out;
    };
    const playsets = rows<{ id: string; name: string; isActive: number; isRemoved: number | null }>(
      'SELECT id, name, isActive, isRemoved FROM playsets',
    ).filter((p) => !p.isRemoved);
    return playsets.map((p) => ({
      id: p.id,
      name: p.name.trim(),
      isActive: !!p.isActive,
      mods: rows<{
        id: string;
        displayName: string;
        steamId: string | null;
        source: string;
        dirPath: string | null;
        position: number;
        version: string | null;
        timeUpdated: number | null;
      }>(
        `SELECT m.id, m.displayName, m.steamId, m.source, m.dirPath, pm.position, m.version, m.timeUpdated
           FROM playsets_mods pm JOIN mods m ON m.id = pm.modId
          WHERE pm.playsetId = ? AND pm.enabled = 1
          ORDER BY pm.position`,
        [p.id],
      ).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        steamId: m.steamId ?? undefined,
        source: m.source,
        dirPath: m.dirPath ?? undefined,
        position: m.position,
        version: m.version ?? undefined,
        timeUpdated: m.timeUpdated ?? undefined,
      })),
    }));
  } finally {
    db.close();
  }
}
