// Reads CK3 save files (.ck3). A save starts with one header line, "SAV01" + a 2-digit type + two 8-digit hex
// numbers (the second is the size of the meta data that follows). Types seen so far:
//   02  meta data as text, then a zip with a text "gamestate" (manual saves)
//   01  binary, not zipped (autosaves)     03  binary, zipped
// Binary saves use a token table that is not public, so they cannot be read.
//
// A gamestate has hundreds of MB, so it stays as bytes: an index finds the top-level sections and the entries
// inside them, and only the blocks that are asked for get decoded and parsed.

import { unzipSync } from 'fflate';
import { parsePdx, type PdxBlock } from '../pdx/parser.ts';

export class SaveFormatError extends Error {}

const NL = 10;
const OPEN = 123;
const CLOSE = 125;
const QUOTE = 34;
const EQ = 61;

const decoder = new TextDecoder();
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function startsWith(bytes: Uint8Array, prefix: Uint8Array, at = 0): boolean {
  for (let i = 0; i < prefix.length; i++) if (bytes[at + i] !== prefix[i]) return false;
  return true;
}

const META = ascii('meta_data');
const ZIP = ascii('PK\x03\x04');

/** The gamestate text of a save file; throws SaveFormatError for binary (autosave, Ironman) or unknown files. */
export function unpackSave(file: Uint8Array): Uint8Array {
  const headerEnd = file.indexOf(NL);
  const header = decoder.decode(file.subarray(0, Math.max(headerEnd, 0)));
  const m = /^SAV\d\d(\d\d)[0-9a-f]{8}([0-9a-f]{8})$/.exec(header);
  if (!m) throw new SaveFormatError('This is not a Crusader Kings III save file.');
  const metaEnd = headerEnd + 1 + parseInt(m[2]!, 16);
  let body = file.subarray(headerEnd + 1);
  if (startsWith(file, ZIP, metaEnd)) {
    const files = unzipSync(file.subarray(metaEnd), { filter: (f) => f.name === 'gamestate' });
    if (!files.gamestate) throw new SaveFormatError('This save file has no game state.');
    body = files.gamestate;
  }
  if (!startsWith(body, META)) {
    throw new SaveFormatError('This save is in the binary format, which cannot be read. Autosaves use it; save the game by hand and pick that file.');
  }
  return body;
}

export interface SaveHead {
  readable: boolean;
  date?: string;
  ruler?: string;
  title?: string;
  house?: string;
}

/** What the start of a save file tells without reading the rest: enough for a list of saves. */
export function parseSaveHead(head: string): SaveHead {
  const type = /^SAV\d\d(\d\d)/.exec(head)?.[1];
  const field = (key: string) => new RegExp(`${key}="?([^"\\n]*)"?`).exec(head)?.[1];
  return {
    readable: type !== undefined && head.includes('meta_data={') && type !== '01' && type !== '03',
    date: field('meta_date'),
    ruler: field('meta_player_name'),
    title: field('meta_title_name'),
    house: field('meta_house_name'),
  };
}

const isDigit = (c: number | undefined) => c !== undefined && c >= 48 && c <= 57;
const isKeyStart = (c: number | undefined) => c !== undefined && ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95);

export class SaveData {
  private sections = new Map<string, [number, number]>();
  private entryIndex = new Map<string, Map<number, number>>();

  constructor(readonly bytes: Uint8Array) {
    // Top-level keys start at column 0. Numeric entries (at column 0 in some sections) are not section keys.
    let last: string | undefined;
    let i = 0;
    while (i < bytes.length) {
      if (isKeyStart(bytes[i])) {
        let j = i;
        while (j < bytes.length && bytes[j] !== EQ && bytes[j] !== NL) j++;
        if (bytes[j] === EQ) {
          const key = decoder.decode(bytes.subarray(i, j));
          if (last) this.sections.get(last)![1] = i;
          // The first of repeated keys wins; `triggered_event` and the like are not needed.
          if (!this.sections.has(key)) {
            this.sections.set(key, [i, bytes.length]);
            last = key;
          } else last = undefined;
        }
      }
      const nl = bytes.indexOf(NL, i);
      if (nl < 0) break;
      i = nl + 1;
    }
  }

  has(key: string): boolean {
    return this.sections.has(key);
  }

  /** Text of a small section, such as `date=8253.7.6`. */
  scalar(key: string): string | undefined {
    const r = this.sections.get(key);
    if (!r) return undefined;
    const text = decoder.decode(this.bytes.subarray(r[0], r[1]));
    return text.slice(text.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
  }

  /** Parses a whole section; only for small ones. */
  block(key: string): PdxBlock | undefined {
    const r = this.sections.get(key);
    if (!r) return undefined;
    const value = parsePdx(decoder.decode(this.bytes.subarray(r[0], r[1]))).entries[0]?.value;
    return value && typeof value === 'object' && value.kind === 'block' ? value : undefined;
  }

  /** Offsets of `<id>={` entries at the given indentation in a section (or a part of it). */
  private index(section: string, indent: number, within?: string): Map<number, number> {
    const name = `${section}/${within ?? ''}/${indent}`;
    let index = this.entryIndex.get(name);
    if (index) return index;
    index = new Map();
    const range = this.sections.get(section);
    if (range) {
      const { bytes } = this;
      let [i, end] = range;
      if (within) {
        // A sub-block of the section, such as `dynasties={` inside `dynasties`.
        const needle = ascii(`\n\t${within}={`);
        for (let at = bytes.indexOf(NL, i); at >= 0 && at < end; at = bytes.indexOf(NL, at + 1)) {
          if (startsWith(bytes, needle, at)) {
            i = at + needle.length;
            end = this.blockEnd(at + needle.length - 1);
            break;
          }
        }
      }
      for (let nl = bytes.indexOf(NL, i); nl >= 0 && nl < end; nl = bytes.indexOf(NL, nl + 1)) {
        let p = nl + 1;
        let tabs = 0;
        while (bytes[p] === 9) {
          p++;
          tabs++;
        }
        if (tabs !== indent || !isDigit(bytes[p])) continue;
        let id = 0;
        while (isDigit(bytes[p])) id = id * 10 + bytes[p++]! - 48;
        if (bytes[p] === EQ && bytes[p + 1] === OPEN) index.set(id, p + 1);
      }
    }
    this.entryIndex.set(name, index);
    return index;
  }

  private blockEnd(open: number): number {
    const { bytes } = this;
    let depth = 0;
    let quoted = false;
    for (let i = open; i < bytes.length; i++) {
      const c = bytes[i];
      if (c === QUOTE) quoted = !quoted;
      else if (!quoted) {
        if (c === OPEN) depth++;
        else if (c === CLOSE && --depth === 0) return i + 1;
      }
    }
    return bytes.length;
  }

  /** One numbered entry of a section, e.g. a character in `living`. */
  entry(section: string, id: number, indent = 0, within?: string): PdxBlock | undefined {
    const open = this.index(section, indent, within).get(id);
    if (open === undefined) return undefined;
    const parsed = parsePdx(`x=${decoder.decode(this.bytes.subarray(open, this.blockEnd(open)))}`).entries[0]?.value;
    return parsed && typeof parsed === 'object' && parsed.kind === 'block' ? parsed : undefined;
  }

  /** Ids of the entries that contain this text, found without parsing them (e.g. all dragons among the characters). */
  entriesContaining(section: string, text: string, indent = 0, within?: string): number[] {
    const offsets = [...this.index(section, indent, within).entries()].sort((a, b) => a[1] - b[1]);
    if (!offsets.length) return [];
    const { bytes } = this;
    const needle = ascii(text);
    const end = this.blockEnd(offsets.at(-1)![1]);
    const found = new Set<number>();
    let e = 0;
    for (let at = bytes.indexOf(needle[0]!, offsets[0]![1]); at >= 0 && at < end; at = bytes.indexOf(needle[0]!, at + 1)) {
      if (!startsWith(bytes, needle, at)) continue;
      while (e + 1 < offsets.length && offsets[e + 1]![1] <= at) e++;
      found.add(offsets[e]![0]);
    }
    return [...found];
  }

  /** Ids of all entries of a section. */
  ids(section: string, indent = 0, within?: string): number[] {
    return [...this.index(section, indent, within).keys()];
  }
}
