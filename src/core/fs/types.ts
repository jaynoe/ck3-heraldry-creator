// Platform-neutral read-only file access. Node (dev/tests), the browser directory picker
// and a future Tauri shell each provide an implementation.

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface FileSource {
  /** Human-readable label, e.g. a mod name or "CK3". */
  readonly label: string;
  /** Entries directly inside `dir` ('' is the root). Returns [] when the directory does not exist. */
  list(dir: string): Promise<DirEntry[]>;
  /** File contents, or undefined when the file does not exist. */
  read(path: string): Promise<Uint8Array | undefined>;
}

const utf8 = new TextDecoder('utf-8');

export async function readText(src: FileSource, path: string): Promise<string | undefined> {
  const bytes = await src.read(path);
  return bytes && utf8.decode(bytes);
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

/** Recursively list all file paths below `dir`, relative to the source root. */
export async function walk(src: FileSource, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await src.list(dir)) {
    const p = joinPath(dir, e.name);
    if (e.isDir) out.push(...(await walk(src, p)));
    else out.push(p);
  }
  return out;
}
