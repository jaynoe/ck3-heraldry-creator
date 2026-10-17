import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DirEntry, FileSource } from '../core/fs/types.ts';

/** FileSource backed by a local directory (Node only). */
export class NodeFileSource implements FileSource {
  constructor(
    readonly root: string,
    readonly label: string = root,
  ) {}

  async list(dir: string): Promise<DirEntry[]> {
    try {
      const entries = await readdir(join(this.root, dir), { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return [];
    }
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(join(this.root, path)));
    } catch {
      return undefined;
    }
  }
}
