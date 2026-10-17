import { getAll, getFirst, isBlock, parsePdx } from '../pdx/parser.ts';
import { readText, type FileSource } from '../fs/types.ts';

export interface ModDescriptor {
  name: string;
  version?: string;
  supportedVersion?: string;
  steamId?: string;
  /** Folders whose earlier contents (vanilla and earlier mods) this mod discards. */
  replacePaths: string[];
}

/** Parse a `descriptor.mod` / `*.mod` file. */
export function parseDescriptor(src: string): ModDescriptor {
  const root = parsePdx(src, { resolveVariables: false });
  const str = (k: string) => {
    const v = getFirst(root, k);
    return v === undefined || isBlock(v) || typeof v === 'object' ? undefined : String(v);
  };
  return {
    name: str('name') ?? 'Unnamed mod',
    version: str('version'),
    supportedVersion: str('supported_version'),
    steamId: str('remote_file_id'),
    replacePaths: getAll(root, 'replace_path')
      .filter((v): v is string => typeof v === 'string')
      .map((p) => p.replace(/\/+$/, '')),
  };
}

/**
 * Read a mod folder's descriptor. Prefers `descriptor.mod`, then any `*.mod` file in the root,
 * then the newer launcher's `.metadata/metadata.json`.
 */
export async function readModDescriptor(src: FileSource): Promise<ModDescriptor | undefined> {
  const direct = await readText(src, 'descriptor.mod');
  if (direct) return parseDescriptor(direct);
  const other = (await src.list('')).find((e) => !e.isDir && e.name.endsWith('.mod'));
  if (other) {
    const text = await readText(src, other.name);
    if (text) return parseDescriptor(text);
  }
  const meta = await readText(src, '.metadata/metadata.json');
  if (meta) {
    try {
      const j = JSON.parse(meta) as { name?: string; version?: string; game_custom_data?: { replace_paths?: string[] } };
      return { name: j.name ?? 'Unnamed mod', version: j.version, replacePaths: j.game_custom_data?.replace_paths ?? [] };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
