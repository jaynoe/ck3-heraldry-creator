import { parseNamedColors } from '../coa/colors.ts';
import type { CoatOfArms, ColorValue } from '../coa/model.ts';
import { parseCoaFile } from '../coa/parse.ts';
import { decodeDds, type RgbaImage } from '../dds/dds.ts';
import type { LayeredFile, LayeredFs } from '../fs/layered.ts';
import { getAll, getFirst, isBlock, parsePdx } from '../pdx/parser.ts';
import { parseLocalization } from './localization.ts';

export type AssetKind = 'colored_emblem' | 'textured_emblem' | 'pattern';

export const ASSET_DIRS: Record<AssetKind, string> = {
  colored_emblem: 'gfx/coat_of_arms/colored_emblems',
  textured_emblem: 'gfx/coat_of_arms/textured_emblems',
  pattern: 'gfx/coat_of_arms/patterns',
};

export interface AssetEntry {
  kind: AssetKind;
  /** File name as referenced in CoA scripts, e.g. "ce_lion_rampant.dds". */
  name: string;
  file: LayeredFile;
  /** Number of colours the designer offers (colored emblems). */
  colors?: number;
  category?: string;
  /** Whether the in-game designer lists the asset. Unlisted assets still work in scripts. */
  visible: boolean;
}

export interface CoaDefinition {
  key: string;
  coa: CoatOfArms;
  file: LayeredFile;
}

export interface Dynasty {
  key: string;
  name: string;
  culture?: string;
  /** Localised house words. */
  mottos: string[];
  /** Taken from the defining file name, e.g. "north" for 00_agot_dyn_north.txt. */
  group: string;
  /** For a house (common/dynasty_houses, e.g. house_Karstark): the dynasty it belongs to. */
  dynasty?: string;
  file: LayeredFile;
}

export interface BookmarkCharacter {
  name: string;
  /** Dynasty key, e.g. "dynn_Stark". */
  dynasty?: string;
  /** Localised name of the character's main title. */
  title?: string;
}

/** A start date offered in the game's setup screen. */
export interface Bookmark {
  key: string;
  name: string;
  description: string;
  /** In-game start date, e.g. "8259.1.1" (AGOT counts 8000 + AC). */
  startDate: string;
  /** Localised era/group, e.g. "Fire and Blood". */
  group?: string;
  characters: BookmarkCharacter[];
}

/** A game rule from a mod (vanilla rules are left out to keep prompts short). */
export interface GameRule {
  key: string;
  name: string;
  options: { key: string; name: string }[];
  default?: string;
}

export interface Catalog {
  assets: Record<AssetKind, Map<string, AssetEntry>>;
  namedColors: Map<string, ColorValue>;
  /** Colour names offered by the in-game designer palette, in order. */
  designerColors: string[];
  coas: Map<string, CoaDefinition>;
  dynasties: Map<string, Dynasty>;
  bookmarks: Bookmark[];
  gameRules: GameRule[];
  /** Culture → its house CoA frame (`house_coa_frame`), which sets the shield shape in game. */
  cultureFrames: Map<string, string>;
  localization: Map<string, string>;
}

/** "8259.1.1" → "259 AC" for AGOT dates, otherwise the year itself. */
export function bookmarkYear(startDate: string): string {
  const year = Number(startDate.split('.')[0]);
  return year >= 7000 ? `${year - 8000} AC` : String(year);
}

/** Strips CK3 text markup (#bold …#!, [Concepts], $vars$) from localised text. */
const plainText = (s: string) =>
  s
    .replace(/#[A-Za-z_]+ ?|#!/g, '')
    .replace(/@[A-Za-z_]+!\s*/g, '')
    .replace(/\[([^|\]]*\|)?([^\]]*)\]/g, '$2')
    .replace(/\$[^$]*\$/g, '')
    .replace(/\\n/g, '\n')
    .trim();

async function eachScript(fs: LayeredFs, dir: string, fn: (text: string, file: LayeredFile) => void) {
  for (const f of await fs.listFiles(dir)) {
    if (!f.path.endsWith('.txt')) continue;
    const text = await fs.readText(f);
    if (text === undefined) continue;
    try {
      fn(text, f);
    } catch (e) {
      console.warn(`Skipping ${f.layer.name}: ${f.path}: ${(e as Error).message}`);
    }
  }
}

async function loadAssets(fs: LayeredFs, kind: AssetKind): Promise<Map<string, AssetEntry>> {
  const dir = ASSET_DIRS[kind];
  const out = new Map<string, AssetEntry>();
  const files = await fs.listFiles(dir);
  for (const f of files) {
    const name = f.path.slice(dir.length + 1);
    if (name.toLowerCase().endsWith('.dds')) out.set(name, { kind, name, file: f, visible: false });
  }
  // Designer metadata: `file.dds = { colors = N category = X visible = no }`
  await eachScript(fs, dir, (text) => {
    for (const e of parsePdx(text).entries) {
      const asset = out.get(e.key);
      if (!asset || !isBlock(e.value)) continue;
      const colors = getFirst(e.value, 'colors');
      const category = getFirst(e.value, 'category');
      if (typeof colors === 'number') asset.colors = colors;
      if (typeof category === 'string') asset.category = category;
      asset.visible = getFirst(e.value, 'visible') !== 'no';
    }
  });
  return out;
}

async function loadLocalization(fs: LayeredFs, language: string): Promise<Map<string, string>> {
  // Only walk the folders of one language; mods use both localization/<lang>/… and localization/replace/<lang>/….
  const deep = await Promise.all([fs.listFilesDeep(`localization/${language}`), fs.listFilesDeep(`localization/replace/${language}`)]);
  const files = deep.flat().filter((f) => f.path.endsWith(`_l_${language}.yml`));
  // Entries under a `replace` folder override everything else.
  files.sort((a, b) => Number(a.path.includes('/replace/')) - Number(b.path.includes('/replace/')));
  const out = new Map<string, string>();
  for (const f of files) {
    const text = await fs.readText(f);
    if (text) parseLocalization(text, out);
  }
  return out;
}

export async function buildCatalog(fs: LayeredFs, language = 'english'): Promise<Catalog> {
  const [colored, textured, patterns, localization] = await Promise.all([
    loadAssets(fs, 'colored_emblem'),
    loadAssets(fs, 'textured_emblem'),
    loadAssets(fs, 'pattern'),
    loadLocalization(fs, language),
  ]);

  const namedColors = new Map<string, ColorValue>();
  await eachScript(fs, 'common/named_colors', (text) => {
    for (const [k, v] of parseNamedColors(text)) namedColors.set(k, v);
  });

  const designerColors: string[] = [];
  await eachScript(fs, 'gfx/coat_of_arms/color_palettes', (text) => {
    const bg = getFirst(parsePdx(text), 'coa_designer_background_colors');
    if (isBlock(bg)) for (const e of bg.entries) if (!designerColors.includes(e.key)) designerColors.push(e.key);
  });

  const coas = new Map<string, CoaDefinition>();
  await eachScript(fs, 'common/coat_of_arms/coat_of_arms', (text, file) => {
    for (const [key, coa] of parseCoaFile(text)) coas.set(key, { key, coa, file });
  });

  // Some AGOT names have no localisation; the game then shows the bare name ("dynn_Karstark" → "Karstark").
  const nameOf = (key: string) => localization.get(key) ?? key.replace(/^(dynn|house)_/, '').replace(/_/g, ' ');
  const dynasties = new Map<string, Dynasty>();
  await eachScript(fs, 'common/dynasties', (text, file) => {
    const group = file.path
      .split('/')
      .pop()!
      .replace(/\.txt$/, '')
      .replace(/^\d+_(agot_)?(dyn_)?/, '');
    for (const e of parsePdx(text).entries) {
      if (!isBlock(e.value)) continue;
      const nameKey = getFirst(e.value, 'name');
      const culture = getFirst(e.value, 'culture');
      const mottoKeys = getAll(e.value, 'motto').filter((m): m is string => typeof m === 'string');
      dynasties.set(e.key, {
        key: e.key,
        name: typeof nameKey === 'string' ? nameOf(nameKey) : e.key,
        culture: typeof culture === 'string' ? culture : undefined,
        mottos: mottoKeys.map((k) => localization.get(k)).filter((m): m is string => !!m),
        group,
        file,
      });
    }
  });

  // Houses of a dynasty (AGOT: Karstark and Greystark under Stark) are separate entries with their own arms.
  await eachScript(fs, 'common/dynasty_houses', (text, file) => {
    for (const e of parsePdx(text).entries) {
      if (!isBlock(e.value)) continue;
      const nameKey = getFirst(e.value, 'name');
      const dynastyKey = getFirst(e.value, 'dynasty');
      const parent = typeof dynastyKey === 'string' ? dynasties.get(dynastyKey) : undefined;
      if (typeof nameKey !== 'string' || !parent) continue;
      const name = nameOf(nameKey);
      if (name === parent.name) continue; // the dynasty's main house is already listed
      const mottoKeys = getAll(e.value, 'motto').filter((m): m is string => typeof m === 'string');
      dynasties.set(e.key, {
        key: e.key,
        name,
        culture: parent.culture,
        mottos: mottoKeys.map((k) => localization.get(k)).filter((m): m is string => !!m),
        group: parent.group,
        dynasty: parent.key,
        file,
      });
    }
  });

  const loc = (key: unknown) => (typeof key === 'string' ? plainText(localization.get(key) ?? key) : undefined);

  const groups = new Map<string, string>();
  await eachScript(fs, 'common/bookmarks/groups', (text) => {
    for (const e of parsePdx(text).entries) if (isBlock(e.value)) groups.set(e.key, loc(e.key)!);
  });
  const bookmarks: Bookmark[] = [];
  await eachScript(fs, 'common/bookmarks/bookmarks', (text) => {
    for (const e of parsePdx(text).entries) {
      if (!isBlock(e.value)) continue;
      const start = getFirst(e.value, 'start_date');
      if (start === undefined || getFirst(e.value, 'is_playable') === 'no') continue;
      const group = getFirst(e.value, 'group');
      bookmarks.push({
        key: e.key,
        name: loc(e.key)!,
        description: loc(`${e.key}_desc`) ?? '',
        startDate: String(start),
        group: typeof group === 'string' ? (groups.get(group) ?? group) : undefined,
        characters: getAll(e.value, 'character').flatMap((c) => {
          if (!isBlock(c)) return [];
          const dynasty = getFirst(c, 'dynasty');
          const title = getFirst(c, 'title');
          return [{ name: loc(getFirst(c, 'name')) ?? '?', dynasty: typeof dynasty === 'string' ? dynasty : undefined, title: loc(title) }];
        }),
      });
    }
  });
  bookmarks.sort((a, b) => Number(a.startDate.split('.')[0]) - Number(b.startDate.split('.')[0]));

  // Mods often override vanilla's rule files; rules in a file that vanilla also has count as vanilla.
  const vanilla = fs.layers.find((l) => l.id === 'vanilla');
  const vanillaRuleFiles = new Set(vanilla ? (await vanilla.source.list('common/game_rules')).map((e) => e.name) : []);
  const gameRules: GameRule[] = [];
  await eachScript(fs, 'common/game_rules', (text, file) => {
    if (file.layer.id === 'vanilla' || vanillaRuleFiles.has(file.path.split('/').pop()!)) return;
    for (const e of parsePdx(text).entries) {
      if (!isBlock(e.value)) continue;
      const options = e.value.entries.filter((o) => isBlock(o.value) && o.key !== 'categories').map((o) => ({ key: o.key, name: loc(`setting_${o.key}`)! }));
      if (!options.length) continue;
      const def = getFirst(e.value, 'default');
      gameRules.push({ key: e.key, name: loc(`rule_${e.key}`)!, options, default: typeof def === 'string' ? def : undefined });
    }
  });

  const cultureFrames = new Map<string, string>();
  await eachScript(fs, 'common/culture/cultures', (text) => {
    for (const e of parsePdx(text).entries) {
      const frame = isBlock(e.value) ? getFirst(e.value, 'house_coa_frame') : undefined;
      if (typeof frame === 'string') cultureFrames.set(e.key, frame);
    }
  });

  return {
    assets: { colored_emblem: colored, textured_emblem: textured, pattern: patterns },
    namedColors,
    designerColors,
    coas,
    dynasties,
    bookmarks,
    gameRules,
    cultureFrames,
    localization,
  };
}

/** Decodes and caches textures on demand. */
export class TextureCache {
  private cache = new Map<string, Promise<RgbaImage | undefined>>();
  constructor(
    private fs: LayeredFs,
    private catalog: Catalog,
  ) {}

  get(kind: AssetKind, name: string): Promise<RgbaImage | undefined> {
    const key = `${kind}/${name}`;
    let p = this.cache.get(key);
    if (!p) {
      p = (async () => {
        const entry = this.catalog.assets[kind].get(name);
        const bytes = entry && (await this.fs.read(entry.file));
        if (!bytes) return undefined;
        try {
          return decodeDds(bytes);
        } catch (e) {
          console.warn(`Cannot decode ${key}: ${(e as Error).message}`);
          return undefined;
        }
      })();
      this.cache.set(key, p);
    }
    return p;
  }

  /** A texture outside the asset folders, e.g. "gfx/coat_of_arms/coa_mask_texture.dds". */
  async getPath(path: string): Promise<RgbaImage | undefined> {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const file = (await this.fs.listFiles(dir)).find((f) => f.path.toLowerCase() === path.toLowerCase());
    const bytes = file && (await this.fs.read(file));
    return bytes ? decodeDds(bytes) : undefined;
  }
}
