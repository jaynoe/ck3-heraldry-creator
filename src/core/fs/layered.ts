// Virtual file system that mimics how CK3 stacks the game and mods:
// files with the same relative path are overridden by later layers, and a layer's
// `replace_path` hides everything earlier layers put in that folder.

import { joinPath, readText, type FileSource } from './types.ts';

export interface Layer {
  source: FileSource;
  /** Stable id of the layer, e.g. "vanilla" or the launcher mod id. */
  id: string;
  name: string;
  replacePaths: string[];
}

export interface LayeredFile {
  /** Path relative to the game/mod root. */
  path: string;
  layer: Layer;
}

export class LayeredFs {
  /** @param layers in load order; vanilla first. */
  constructor(readonly layers: readonly Layer[]) {}

  private visibleFrom(dir: string): number {
    let start = 0;
    this.layers.forEach((l, i) => {
      if (l.replacePaths.some((p) => dir === p || dir.startsWith(p + '/'))) start = i;
    });
    return start;
  }

  /** Files directly in `dir`, merged across layers, keyed by file name. Later layers win. */
  async listFiles(dir: string): Promise<LayeredFile[]> {
    const byName = new Map<string, LayeredFile>();
    for (let i = this.visibleFrom(dir); i < this.layers.length; i++) {
      const layer = this.layers[i]!;
      for (const e of await layer.source.list(dir)) {
        if (!e.isDir) byName.set(e.name.toLowerCase(), { path: joinPath(dir, e.name), layer });
      }
    }
    return [...byName.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  /** Like listFiles, but recursive; the key is the path relative to `dir`. */
  async listFilesDeep(dir: string): Promise<LayeredFile[]> {
    const byPath = new Map<string, LayeredFile>();
    const visit = async (layer: Layer, d: string) => {
      for (const e of await layer.source.list(d)) {
        const p = joinPath(d, e.name);
        if (e.isDir) await visit(layer, p);
        else if (this.visibleFrom(d) <= this.layers.indexOf(layer)) byPath.set(p.toLowerCase(), { path: p, layer });
      }
    };
    for (const layer of this.layers) await visit(layer, dir);
    return [...byPath.values()];
  }

  async read(file: LayeredFile): Promise<Uint8Array | undefined> {
    return file.layer.source.read(file.path);
  }

  async readText(file: LayeredFile): Promise<string | undefined> {
    return readText(file.layer.source, file.path);
  }
}
