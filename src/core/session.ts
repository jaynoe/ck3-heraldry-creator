// Ties the pieces together: game + playset mods → layered FS → catalog → render context.

import { frameArtPath, frameMaskPath } from './render/frame.ts';
import { buildCatalog, TextureCache, type AssetKind, type Catalog } from './catalog/catalog.ts';
import type { RgbaImage } from './dds/dds.ts';
import { LayeredFs, type Layer } from './fs/layered.ts';
import type { FileSource } from './fs/types.ts';
import { readModDescriptor } from './mods/descriptor.ts';
import { buildMips } from './render/image.ts';
import type { RenderContext } from './render/render.ts';

export interface ModSource {
  id: string;
  name: string;
  source: FileSource;
}

/** Build layers in load order (game first). Descriptors supply each mod's replace_path list. */
export async function createLayers(game: FileSource, mods: ModSource[]): Promise<Layer[]> {
  const layers: Layer[] = [{ source: game, id: 'vanilla', name: 'Crusader Kings III', replacePaths: [] }];
  for (const m of mods) {
    const descriptor = await readModDescriptor(m.source);
    layers.push({ source: m.source, id: m.id, name: m.name, replacePaths: descriptor?.replacePaths ?? [] });
  }
  return layers;
}

export class HeraldrySession {
  readonly textures: TextureCache;
  private mips = new Map<string, Promise<RgbaImage[] | undefined>>();

  private constructor(
    readonly fs: LayeredFs,
    readonly catalog: Catalog,
  ) {
    this.textures = new TextureCache(fs, catalog);
  }

  static async open(layers: Layer[], language = 'english'): Promise<HeraldrySession> {
    const fs = new LayeredFs(layers);
    return new HeraldrySession(fs, await buildCatalog(fs, language));
  }

  /** Use a catalog restored from the cache instead of reading the game files. */
  static fromCatalog(layers: Layer[], catalog: Catalog): HeraldrySession {
    return new HeraldrySession(new LayeredFs(layers), catalog);
  }

  private masks = new Map<string, Promise<RgbaImage | undefined>>();
  /** Alpha mask of a house frame (shield shape), or undefined if the playset has no such file. */
  frameMask(frame: string): Promise<RgbaImage | undefined> {
    let p = this.masks.get(frame);
    if (!p) {
      p = this.textures.getPath(frameMaskPath(frame)).catch(() => undefined);
      this.masks.set(frame, p);
    }
    return p;
  }

  private arts = new Map<string, Promise<RgbaImage | undefined>>();
  /** Frame art (a strip of tiers) for a house frame, or undefined if the playset has none. */
  frameArt(frame: string): Promise<RgbaImage | undefined> {
    let p = this.arts.get(frame);
    if (!p) {
      p = this.textures.getPath(frameArtPath(frame)).catch(() => undefined);
      this.arts.set(frame, p);
    }
    return p;
  }

  async renderContext(options: { shading?: boolean } = {}): Promise<RenderContext> {
    return {
      getTexture: (kind: AssetKind, name: string) => {
        const key = `${kind}/${name}`;
        let p = this.mips.get(key);
        if (!p) {
          p = this.textures.get(kind, name).then((img) => img && buildMips(img));
          this.mips.set(key, p);
        }
        return p;
      },
      getCoa: (key) => this.catalog.coas.get(key)?.coa,
      namedColors: this.catalog.namedColors,
      shading: options.shading ? await this.textures.getPath('gfx/coat_of_arms/coa_mask_texture.dds') : undefined,
    };
  }
}
