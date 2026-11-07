// Records on demand: the Maester asks for a person, house or title by name and gets what the save knows,
// so all of the save stays within reach while only a small part goes into the prompt.

import { all, formatDate, nums, num, personLine, str, sub, year, NONE, type SaveReader } from './digest.ts';
import type { SaveData } from './save-file.ts';

const TIERS: Record<string, string> = { e: 'empire', k: 'kingdom', d: 'duchy', c: 'county', b: 'barony' };

export class SaveRecords {
  private titleIds?: Map<string, number>;
  private houseIds?: Map<string, number>;

  constructor(
    private save: SaveData,
    private reader: SaveReader,
  ) {}

  /** What the save knows about a name; a person, house or title, whichever matches. */
  lookup(query: string): string {
    const q = query.trim().replace(/^"|"$/g, '');
    if (!q) return 'No name given.';
    const house = /^house\s+/i.test(q) ? q.replace(/^house\s+/i, '') : undefined;
    const parts = [house ? this.houseRecord(house) : undefined];
    if (!house) parts.push(...this.people(q), this.titleRecord(q), this.houseRecord(q));
    const found = parts.filter((p): p is string => !!p);
    return found.length ? found.slice(0, 4).join('\n\n') : `No record found for "${q}".`;
  }

  private people(q: string): string[] {
    const { save, reader } = this;
    const [first, ...rest] = q.replace(/^(lord|lady|king|queen|prince|princess|ser|maester)\s+/i, '').split(/\s+/);
    if (!first) return [];
    const wanted = rest.join(' ').toLowerCase();
    const myHouse = num(reader.character(num(save.block('played_character'), 'character') ?? -1), 'dynasty_house');
    const candidates = ['living', 'dead_unprunable', 'characters'].flatMap((section) => save.entriesContaining(section, `first_name="${first}"`));
    const scored = candidates
      .map((id) => {
        const c = reader.character(id);
        const name = reader.nameOf(id).toLowerCase();
        const nick = (str(c, 'nickname_text') ?? '').toLowerCase();
        // The lord's own house first, then the living and rulers; they are who people usually mean.
        const ownHouse = myHouse !== undefined && num(c, 'dynasty_house') === myHouse;
        return { id, match: !wanted || name.includes(wanted) || nick.includes(wanted), score: (ownHouse ? 4 : 0) + (sub(c, 'dead_data') ? 0 : 2) + (sub(c, 'landed_data') ? 1 : 0) };
      })
      .filter((c) => c.match)
      .sort((a, b) => b.score - a.score);
    const records = scored.slice(0, 3).map((c) => this.personRecord(c.id));
    if (scored.length > 3) records.push(`(${scored.length - 3} more people are called ${q}; ask with a house name to narrow it down.)`);
    return records;
  }

  private personRecord(id: number): string {
    const { reader } = this;
    const p = reader.person(id)!;
    const c = reader.character(id);
    const fam = sub(c, 'family_data');
    const landed = sub(c, 'landed_data');
    const held = nums(landed, 'domain')
      .map((t) => ({ key: str(reader.title(t), 'key') ?? '', name: reader.titleName(t) }))
      .filter((t) => /^[ekd]_/.test(t.key))
      .slice(0, 6)
      .map((t) => `${t.name} (${TIERS[t.key[0]!]})`);
    const spouses = all(fam, 'spouse').filter((v): v is number => typeof v === 'number');
    const employer = num(sub(c, 'court_data'), 'employer');
    const memories = reader
      .memoriesOf(c)
      .flatMap((m) => {
        const text = reader.say(m, id);
        return text ? [`${year(m.date)}: ${text}`] : [];
      })
      .slice(-10);
    const artifacts = this.save
      .entriesContaining('artifacts', `owner=${id}\n`, 2, 'artifacts')
      .slice(0, 12)
      .flatMap((a) => str(this.save.entry('artifacts', a, 2, 'artifacts'), 'name') ?? []);
    const lines = [
      `Record of ${personLine(p)}${p.isDragon ? ' (a dragon)' : ''}`,
      p.deathReason && `Death: ${p.deathReason}.`,
      p.traits.length > 0 && `Traits: ${p.traits.join(', ')}`,
      p.skills && !p.isDragon && `Skills: ${Object.entries(p.skills).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      held.length > 0 && `Holds: ${held.join(', ')}`,
      landed && `Troops: ${Math.round(num(landed, 'strength') ?? 0)}`,
      employer !== undefined && `At the court of ${reader.nameOf(employer)}`,
      artifacts.length > 0 && `Artifacts: ${artifacts.join(', ')}`,
      `Parents: ${reader.parentsOf(id).map(reader.nameOf).join(', ') || 'unknown'}`,
      spouses.length > 0 && `Spouses: ${spouses.map(reader.nameOf).join(', ')}`,
      nums(fam, 'child').length > 0 && `Children: ${nums(fam, 'child').map(reader.nameOf).join(', ')}`,
      num(fam, 'betrothed') !== undefined && `Betrothed to ${reader.nameOf(num(fam, 'betrothed'))}`,
      memories.length > 0 && `Remembered:\n${memories.map((m) => `- ${m}`).join('\n')}`,
    ];
    return lines.filter(Boolean).join('\n');
  }

  private titleRecord(q: string): string | undefined {
    const { save, reader } = this;
    if (!this.titleIds) {
      this.titleIds = new Map();
      for (const id of save.ids('landed_titles')) {
        const name = reader.titleName(id);
        if (name && !this.titleIds.has(name.toLowerCase())) this.titleIds.set(name.toLowerCase(), id);
      }
    }
    const id = this.titleIds.get(q.toLowerCase().replace(/^the\s+/, '')) ?? this.titleIds.get(q.toLowerCase()) ?? this.titleIds.get(`the ${q.toLowerCase()}`);
    if (id === undefined) return undefined;
    const t = reader.title(id);
    const key = str(t, 'key') ?? '';
    const holder = num(t, 'holder');
    const history = (sub(t, 'history')?.entries ?? [])
      .slice(-6)
      .map((e) => {
        const who = typeof e.value === 'number' ? e.value : e.value && typeof e.value === 'object' && e.value.kind === 'block' ? num(e.value, 'holder') : undefined;
        return `${e.key.startsWith('8') ? year(e.key) : e.key}: ${who === undefined || who === NONE ? 'no holder' : reader.nameOf(who)}`;
      });
    return [
      `Record of ${reader.titleName(id)} (${TIERS[key[0] ?? ''] ?? 'title'})`,
      `Held by ${holder === undefined ? 'nobody' : reader.nameOf(holder)}`,
      num(t, 'de_facto_liege') !== undefined && `Under ${reader.titleName(num(t, 'de_facto_liege'))}`,
      reader.liegesOf(id).length > 0 && `Answers to ${reader.liegesOf(id).map(reader.nameOf).join(', then ')}`,
      history.length > 0 && `Recent holders:\n${history.map((h) => `- ${h}`).join('\n')}`,
    ].filter(Boolean).join('\n');
  }

  private houseRecord(q: string): string | undefined {
    const { save, reader } = this;
    if (!this.houseIds) {
      this.houseIds = new Map();
      for (const id of save.ids('dynasties', 0, 'dynasty_house')) {
        const name = reader.houseName(id);
        if (name) this.houseIds.set(name.toLowerCase(), id);
      }
    }
    const id = this.houseIds.get(q.toLowerCase());
    if (id === undefined) return undefined;
    const h = reader.houseBlock(id);
    const motto = str(h, 'motto');
    const found = str(h, 'found_date');
    const members = save.entriesContaining('living', `dynasty_house=${id}\n`);
    const parent = num(h, 'parent_dynasty_house');
    return [
      `Record of House ${reader.houseName(id)}`,
      motto && !reader.loc(motto).endsWith(' motto') && `Words: "${reader.loc(motto)}"`,
      found && !found.startsWith('9999') && `Founded ${formatDate(found)}`,
      parent !== undefined && `Branch of House ${reader.houseName(parent)}`,
      num(h, 'head_of_house') !== undefined && `Head: ${reader.nameOf(num(h, 'head_of_house'))}`,
      `Living members (${members.length}): ${members.slice(0, 15).map(reader.nameOf).join(', ')}`,
    ].filter(Boolean).join('\n');
  }
}
