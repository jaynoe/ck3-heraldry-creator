// FileSource backed by the dev server's /api/fs endpoints (see dev/api-plugin.ts).

import { joinPath, type DirEntry, type FileSource } from '../../core/fs/types.ts';

export class HttpFileSource implements FileSource {
  constructor(
    private root: string,
    readonly label: string,
    /** Server origin; empty in the browser (same origin). */
    private base = '',
  ) {}

  async list(dir: string): Promise<DirEntry[]> {
    const res = await fetch(`${this.base}/api/fs/list?path=${encodeURIComponent(joinPath(this.root, dir))}`);
    return res.ok ? ((await res.json()) as DirEntry[]) : [];
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const res = await fetch(`${this.base}/api/fs/read?path=${encodeURIComponent(joinPath(this.root, path))}`);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : undefined;
  }
}
