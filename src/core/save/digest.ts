// A compact picture of a running campaign, built from a save without any AI: the player's ruler, family, house,
// realm, wars, neighbours and the story so far. This is what the Maester gets instead of the hundreds of MB.
//
// Left out on purpose: what the player cannot know in game, such as other people's secrets and plots against them.

import { coaFromBlock } from '../coa/parse.ts';
import { serializeCoa } from '../coa/serialize.ts';
import { getFirst, getNumbers, isBlock, type PdxBlock, type PdxValue } from '../pdx/parser.ts';
import { SaveData } from './save-file.ts';

/** Localised text for a game key; undefined if unknown. */
export type Localize = (key: string) => string | undefined;

const SKILLS = ['diplomacy', 'martial', 'stewardship', 'intrigue', 'learning', 'prowess'] as const;
export const NONE = 4294967295;

export interface Person {
  id: number;
  name: string;
  nickname?: string;
  house?: string;
  female: boolean;
  birth: string;
  death?: string;
  deathReason?: string;
  age: number;
  traits: string[];
  skills?: Record<(typeof SKILLS)[number], number>;
  isDragon: boolean;
}

export interface Relative extends Person {
  betrothedTo?: string;
  spouses?: string[];
}

export interface StoryEvent {
  date: string;
  text: string;
}

export interface PastRuler {
  person: Person;
  from: string;
  events: StoryEvent[];
  /** Totals that would drown the timeline, e.g. battles won. */
  totals: Record<string, number>;
}

export interface WarInfo {
  name: string;
  started: string;
  side: 'attacker' | 'defender';
  attackers: string[];
  defenders: string[];
  goal: string;
}

export interface SaveDigest {
  date: string;
  startDate: string;
  gameVersion: string;
  ruler: Person & { reignStart?: string; gold: number; prestige: number; piety: number; dread: number; legitimacy?: number; focus?: string; perks: number; location?: string };
  house: { name: string; motto?: string; founded?: string; parent?: string; dynasty?: string; arms?: string };
  family: { parents: Relative[]; siblings: Relative[]; spouses: Relative[]; formerSpouses: Relative[]; children: Relative[]; heirs: Person[] };
  relations: { rivals: string[]; friends: string[]; lovers: string[]; allies: string[]; truces: { name: string; until: string; war: string }[] };
  realm: {
    titles: { tier: string; name: string }[];
    counts: Record<string, number>;
    capital?: string;
    government?: string;
    laws: string[];
    troops: number;
    levy: number;
    vassals: { name: string; title?: string; strength: number }[];
    council: { position: string; name: string }[];
    court: { position: string; name: string }[];
    claims: { name: string; holder?: string; inRealm: boolean; over?: string }[];
  };
  dragons: { name: string; age: number; rider?: string }[];
  wars: WarInfo[];
  otherWars: number;
  neighbours: { title: string; ruler: string; house?: string; strength: number; region?: string }[];
  /** Lands with independent powers that were left out: the lord has no land or allies there. */
  distant: string[];
  story: PastRuler[];
  recent: StoryEvent[];
  world: { living: number; dead: number };
}

// --- values ------------------------------------------------------------------------------------

export const str = (b: PdxBlock | undefined, k: string): string | undefined => {
  const v = b && getFirst(b, k);
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
};
export const num = (b: PdxBlock | undefined, k: string): number | undefined => {
  const v = b && getFirst(b, k);
  return typeof v === 'number' ? v : undefined;
};
export const sub = (b: PdxBlock | undefined, k: string): PdxBlock | undefined => {
  const v = b && getFirst(b, k);
  return isBlock(v) ? v : undefined;
};
export const nums = (b: PdxBlock | undefined, k: string): number[] => (b ? getNumbers(getFirst(b, k)) : []);
export const all = (b: PdxBlock | undefined, k: string): PdxValue[] => (b ? b.entries.filter((e) => e.key === k).map((e) => e.value) : []);
const words = (b: PdxBlock | undefined, k: string): string[] => {
  const v = b && getFirst(b, k);
  return isBlock(v) ? v.values.filter((x): x is string => typeof x === 'string') : [];
};

const dateParts = (d: string) => d.split('.').map(Number) as [number, number, number];
const compareDates = (a: string, b: string) => {
  const [x, y] = [dateParts(a), dateParts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
const yearsBetween = (from: string, to: string) => {
  const [a, b] = [dateParts(from), dateParts(to)];
  return b[0] - a[0] - (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2]) ? 1 : 0);
};
export const year = (d: string) => {
  const y = dateParts(d)[0];
  return y >= 8000 ? `${y - 8000} AC` : y >= 7000 ? `${8000 - y} BC` : String(y);
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "6 July 253 AC": AGOT dates are 8000 + AC. */
export function formatDate(d: string): string {
  const [, m, day] = dateParts(d);
  return `${day} ${MONTHS[m - 1]} ${year(d)}`;
}


const humanize = (key: string) => key.replace(/^(dynn|house|nick|trait)_/, '').replace(/_(perk|law|decision)$/, '').replace(/_/g, ' ');

/** Removes the game's text markup from war names and the like. */
export const cleanText = (s: string) =>
  s
    .replace(/(ONCLICK|TOOLTIP):\S+\s*/g, '')
    .replace(/\b[LE];\s*/g, '')
    .replace(/\b(L|high)\s+/g, '')
    .replace(/!+/g, ' ')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The game's sentence for a death ("tripped and fell to his death"; the reason `blind` means just that). */
function deathText(reason: string | undefined, female: boolean, localize: Localize): string | undefined {
  if (!reason) return undefined;
  const text = localize(reason);
  if (!text) return `died: ${humanize(reason.replace(/^death_/, ''))}`;
  return text
    .replace(/\[[^\]]*GetHerHis[^\]]*\]/g, female ? 'her' : 'his')
    .replace(/\[[^\]]*GetHerHim[^\]]*\]/g, female ? 'her' : 'him')
    .replace(/\[[^\]]*GetSheHe[^\]]*\]/g, female ? 'she' : 'he')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- what memories mean -------------------------------------------------------------------------

type Names = (b: PdxBlock, key: string) => string;
/** The memories worth telling, as sentences. Everything else only counts or stays out. */
const MEMORY_TEXT: Record<string, (p: PdxBlock, n: Names) => string> = {
  ascended_throne_memory: (p, n) => `took a throne after ${n(p, 'flavor_character')}`,
  was_coronated: () => 'was crowned',
  married: (p, n) => `married ${n(p, 'spouse')}`,
  first_born: (p, n) => `first child ${n(p, 'child')} was born`,
  child_born: (p, n) => `child ${n(p, 'child')} was born`,
  child_stillborn: () => 'a child was stillborn',
  spouse_died: (p, n) => `spouse ${n(p, 'dead_relation')} died`,
  child_died: (p, n) => `child ${n(p, 'dead_relation')} died`,
  agot_hatched_egg: (p, n) => `hatched the dragon ${n(p, 'dragon')}`,
  agot_tamed_a_dragon: (p, n) => `tamed the dragon ${n(p, 'tamed_dragon')}`,
  agot_dragon_died: (p, n) => `the dragon ${n(p, 'dead_dragon')} died`,
  agot_was_knighted: (p, n) => `was knighted by ${n(p, 'knight')}`,
  became_nemesis: (p, n) => `${n(p, 'nemesis')} became a nemesis`,
  nemesis_died: (p, n) => `nemesis ${n(p, 'dead_relation')} died`,
  became_soulmates: (p, n) => `found a soulmate in ${n(p, 'new_soulmate')}`,
  became_rivals: (p, n) => `became rivals with ${n(p, 'rival')}`,
  rival_died: (p, n) => `rival ${n(p, 'dead_relation')} died`,
  tournament_won_contest_memory: (p, n) => `won a contest at the tournament of ${n(p, 'host')}`,
  offensive_war: (p, n) => `went to war against ${n(p, 'other_party')}`,
  joined_allys_war: (p, n) => `joined the war of ${n(p, 'ally')} against ${n(p, 'enemy')}`,
  ce1_contracted_black_death: () => 'caught the Black Death',
  became_lovers: (p, n) => `became lovers with ${n(p, 'new_relation')}`,
  relative_died: (p, n) => `relative ${n(p, 'dead_relation')} died`,
  friend_died: (p, n) => `friend ${n(p, 'dead_relation')} died`,
  became_friends: (p, n) => `became friends with ${n(p, 'new_relation')}`,
  witnessed_coronation: (p, n) => `witnessed the coronation of ${n(p, 'coronation_target')}`,
};
/** The lands of the AGOT map, by where the de jure chain of a title ends. */
const REGION_BY_TOP: Record<string, string> = { h_the_iron_throne: 'Westeros', e_beyond_the_wall: 'The Wall and beyond', e_the_wall: 'The Wall and beyond' };
const REGION_ELSE = 'Essos and other lands';

/** Too common for the long view of a past ruler; shown in the recent events of the current one. */
const RECENT_ONLY = new Set(['relative_died', 'friend_died', 'became_friends', 'became_rivals', 'rival_died', 'witnessed_coronation']);
const COUNTED: Record<string, string> = {
  battle_won_memory: 'battles won',
  war_won: 'wars won',
  imprisoned_other: 'people imprisoned',
  agot_knighted_someone: 'knights made',
  funded_expedition_valyria: 'expeditions to Valyria funded',
};

const TITLE_CHANGE: Record<string, string> = {
  conquest_claim: 'by conquest',
  conquest: 'by conquest',
  faction_demand: 'by a faction’s demand',
  created: 'by creating it',
  usurped: 'by usurping it',
  granted: 'as a grant',
  claim: 'by pressing a claim',
};

// --- the digest ---------------------------------------------------------------------------------

export type SaveReader = ReturnType<typeof saveReader>;

/** Looks up people, houses, titles and memories in a save, with names resolved; shared by the digest and the record lookups. */
export function saveReader(save: SaveData, localize: Localize = () => undefined) {
  const loc = (key: string) => localize(key) ?? humanize(key);
  const date = save.scalar('date') ?? '';
  const traitNames = (save.block('traits_lookup')?.values ?? []).map(String);
  const character = (id: number) => save.entry('living', id) ?? save.entry('characters', id) ?? save.entry('dead_unprunable', id);

  const houses = new Map<number, string | undefined>();
  const houseBlock = (id: number) => save.entry('dynasties', id, 0, 'dynasty_house');
  const houseName = (id: number | undefined) => {
    if (id === undefined) return undefined;
    if (!houses.has(id)) {
      const h = houseBlock(id);
      const key = str(h, 'name');
      houses.set(id, str(h, 'localized_name') ?? (key ? loc(key) : undefined));
    }
    return houses.get(id);
  };

  const person = (id: number): Person | undefined => {
    const c = character(id);
    if (!c) return undefined;
    const dead = sub(c, 'dead_data');
    const birth = str(c, 'birth') ?? date;
    const death = str(dead, 'date');
    const skills = nums(c, 'skill');
    return {
      id,
      name: str(c, 'first_name') ?? `#${id}`,
      nickname: str(c, 'nickname_text') || undefined,
      house: houseName(num(c, 'dynasty_house')),
      female: str(c, 'female') === 'yes',
      birth,
      death,
      deathReason: deathText(str(dead, 'reason'), str(c, 'female') === 'yes', localize),
      age: yearsBetween(birth, death ?? date),
      traits: nums(c, 'traits').map((t) => traitNames[t]).filter((t): t is string => !!t).map((t) => loc(`trait_${t}`)),
      skills: skills.length === 6 ? (Object.fromEntries(SKILLS.map((s, i) => [s, skills[i]!])) as Person['skills']) : undefined,
      isDragon: str(c, 'ethnicity') === 'dragon',
    };
  };
  const nameCache = new Map<number, string>();
  const nameOf = (id: number | undefined) => {
    if (id === undefined || id === NONE) return 'unknown';
    let n = nameCache.get(id);
    if (!n) {
      const c = character(id);
      const house = houseName(num(c, 'dynasty_house'));
      n = c ? `${str(c, 'first_name') ?? '?'}${house ? ` ${house}` : ''}` : `someone (#${id})`;
      nameCache.set(id, n);
    }
    return n;
  };
  const names: Names = (b, key) => nameOf(num(b, key));

  const titles = new Map<number, PdxBlock | undefined>();
  const title = (id: number) => {
    if (!titles.has(id)) titles.set(id, save.entry('landed_titles', id));
    return titles.get(id);
  };
  const titleName = (id: number | undefined) => {
    const t = id === undefined ? undefined : title(id);
    const custom = str(sub(t, 'title_name_data'), 'name');
    if (custom) return custom;
    const key = str(t, 'key');
    return key ? loc(key) : undefined;
  };

  /** The rulers above a title, nearest first, up to the top of its realm. */
  const liegesOf = (id: number) => {
    const lieges: number[] = [];
    const seen = new Set([id]);
    let last = num(title(id), 'holder');
    for (let up = num(title(id), 'de_facto_liege'); up !== undefined && !seen.has(up); up = num(title(up), 'de_facto_liege')) {
      seen.add(up);
      const holder = num(title(up), 'holder');
      if (holder !== undefined && holder !== last) lieges.push(holder);
      last = holder;
    }
    return lieges;
  };

  const relative = (id: number): Relative | undefined => {
    const p = person(id);
    if (!p) return undefined;
    const fam = sub(character(id), 'family_data');
    const betrothed = num(fam, 'betrothed');
    const spouses = all(fam, 'spouse').filter((v): v is number => typeof v === 'number');
    return { ...p, betrothedTo: betrothed !== undefined ? nameOf(betrothed) : undefined, spouses: spouses.length ? spouses.map(nameOf) : undefined };
  };
  const relatives = (ids: number[]) => ids.map(relative).filter((r): r is Relative => !!r);

  // --- memories
  const memoriesOf = (c: PdxBlock | undefined) => {
    const list = nums(sub(c, 'alive_data'), 'memories').concat(nums(sub(c, 'dead_data'), 'memories'));
    return list.flatMap((id) => {
      const m = save.entry('character_memory_manager', id, 2, 'database');
      const type = str(m, 'type');
      const when = str(m, 'creation_date');
      return m && type && when ? [{ type, date: when, participants: sub(m, 'participants') ?? ({ kind: 'block', entries: [], values: [] } as PdxBlock), ended: str(m, 'end_date') }] : [];
    }).sort((a, b) => compareDates(a.date, b.date));
  };
  const say = (m: { type: string; participants: PdxBlock }, owner: number) =>
    // Creating a title of one's own is remembered as ascending "after" oneself.
    m.type === 'ascended_throne_memory' && num(m.participants, 'flavor_character') === owner ? 'took a new, higher title' : MEMORY_TEXT[m.type]?.(m.participants, names);


  // Parents are only stored on their side, as children.
  const parentsOf = (id: number) => {
    const found = new Set<number>();
    for (const section of ['living', 'dead_unprunable', 'characters']) {
      for (const p of save.entriesContaining(section, `${id}`)) {
        if (p !== id && nums(sub(save.entry(section, p), 'family_data'), 'child').includes(id)) found.add(p);
      }
    }
    return [...found];
  };
  return { loc, date, parentsOf, character, houseBlock, houseName, person, nameOf, names, title, titleName, liegesOf, relative, relatives, memoriesOf, say };
}

export function buildSaveDigest(save: SaveData, localize: Localize = () => undefined): SaveDigest {
  const r0 = saveReader(save, localize);
  const { loc, date, parentsOf, character, houseBlock, houseName, person, nameOf, title, titleName, liegesOf, relatives, memoriesOf, say } = r0;
  const startDate = save.scalar('bookmark_date') ?? date;
  const played = save.block('played_character');
  const playerId = num(played, 'character');
  if (playerId === undefined) throw new Error('This save has no played character (observer mode?).');

  // --- ruler
  const me = character(playerId)!;
  const alive = sub(me, 'alive_data');
  const landed = sub(me, 'landed_data');
  const playable = sub(me, 'playable_data');
  const fam = sub(me, 'family_data');
  const currency = (k: string) => num(sub(alive, k), 'currency') ?? 0;

  const parents = parentsOf(playerId);
  const myMemories = memoriesOf(me);
  const siblings = [...new Set(parents.flatMap((p) => nums(sub(character(p), 'family_data'), 'child')))].filter((c) => c !== playerId);

  const recentFrom = `${dateParts(date)[0] - 10}.1.1`;
  const recent = myMemories
    .filter((m) => compareDates(m.date, recentFrom) >= 0)
    .flatMap((m) => {
      const text = say(m, playerId);
      return text ? [{ date: m.date, text }] : [];
    });

  // Relations are not stored as such on the character; the memories tell who became what, and whether it ended.
  const open = (start: string, key: string, ends: string[]) => {
    const state = new Map<number, boolean>();
    for (const m of myMemories) {
      const who = num(m.participants, key) ?? num(m.participants, 'dead_relation');
      if (who === undefined) continue;
      if (m.type === start) state.set(who, true);
      else if (ends.includes(m.type)) state.set(who, false);
    }
    return [...state].filter(([id, on]) => on && !sub(character(id), 'dead_data')).map(([id]) => nameOf(id));
  };

  // --- story of the player's line
  const legacy = (sub(played, 'legacy')?.values ?? []).filter(isBlock).map((l) => ({ id: num(l, 'character')!, from: str(l, 'date') ?? startDate }));
  const line = new Set(legacy.map((l) => l.id));
  const story: PastRuler[] = legacy.flatMap((l) => {
    const c = character(l.id);
    const p = person(l.id);
    if (!c || !p) return [];
    const totals: Record<string, number> = {};
    const events: StoryEvent[] = [];
    for (const m of memoriesOf(c)) {
      const counted = COUNTED[m.type];
      if (counted) totals[counted] = (totals[counted] ?? 0) + 1;
      if (RECENT_ONLY.has(m.type)) continue;
      const text = say(m, l.id);
      if (text) events.push({ date: m.date, text });
    }
    // How the line got its big titles.
    const held = [...nums(sub(c, 'landed_data'), 'domain'), ...nums(sub(c, 'dead_data'), 'domain')];
    for (const id of new Set(held)) {
      const t = title(id);
      if (!/^[ek]_/.test(str(t, 'key') ?? '')) continue;
      let holder: number | undefined;
      for (const e of sub(t, 'history')?.entries ?? []) {
        const next = typeof e.value === 'number' ? e.value : isBlock(e.value) ? num(e.value, 'holder') : undefined;
        if (next === l.id && !(holder !== undefined && line.has(holder))) {
          const how = isBlock(e.value) ? TITLE_CHANGE[str(e.value, 'type') ?? ''] : undefined;
          events.push({ date: e.key, text: `gained ${titleName(id)}${holder !== undefined && holder !== NONE ? ` from ${nameOf(holder)}` : ''}${how ? ` ${how}` : ''}` });
        }
        if (next !== undefined) holder = next;
      }
    }
    events.sort((a, b) => compareDates(a.date, b.date));
    return [{ person: p, from: l.from, events, totals }];
  });

  // --- realm
  const domain = nums(landed, 'domain');
  const tiers: Record<string, string> = { h: 'hegemony', e: 'empire', k: 'kingdom', d: 'duchy', c: 'county', b: 'barony' };
  const counts: Record<string, number> = {};
  const big: { tier: string; name: string }[] = [];
  for (const id of domain) {
    const key = str(title(id), 'key') ?? '';
    const tier = tiers[key[0] ?? ''];
    if (!tier) continue;
    counts[tier] = (counts[tier] ?? 0) + 1;
    if (tier === 'hegemony' || tier === 'empire' || tier === 'kingdom' || tier === 'duchy') big.push({ tier, name: titleName(id) ?? key });
  }
  const vassals = nums(landed, 'vassal_contracts')
    .map((id) => num(save.entry('vassal_contracts', id, 2, 'database'), 'vassal'))
    .filter((v): v is number => v !== undefined)
    .map((v) => {
      const c = character(v);
      const l = sub(c, 'landed_data');
      return { name: nameOf(v), title: titleName(nums(l, 'domain')[0]), strength: Math.round(num(l, 'strength') ?? 0) };
    })
    .sort((a, b) => b.strength - a.strength);
  const council = nums(landed, 'council').flatMap((id) => {
    const t = save.entry('council_task_manager', id, 2, 'active');
    const who = num(t, 'owner');
    const type = str(t, 'type');
    return who !== undefined && type ? [{ position: localize(type) ?? humanize(type.replace(/^task_/, '')), name: nameOf(who) }] : [];
  });
  const court = nums(landed, 'court_positions').flatMap((id) => {
    const t = save.entry('court_positions', id, 2, 'database');
    const who = num(t, 'employee');
    const type = str(t, 'court_position');
    return who !== undefined && type ? [{ position: localize(type) ?? humanize(type.replace(/_court_position$/, '')), name: nameOf(who) }] : [];
  });
  const claims = (sub(alive, 'claim')?.values ?? []).filter(isBlock).flatMap((c) => {
    const id = num(c, 'title');
    const name = titleName(id);
    if (id === undefined || !name) return [];
    const holder = num(title(id), 'holder');
    if (holder === playerId) return [];
    const lieges = liegesOf(id);
    const inRealm = lieges.includes(playerId);
    // In the realm: the vassal the holder answers to, if not the lord directly. Abroad: the top of that realm.
    const over = inRealm ? (lieges[0] === playerId ? undefined : lieges[0]) : lieges.at(-1);
    return [{ name, holder: holder === undefined ? undefined : nameOf(holder), inRealm, over: over === undefined ? undefined : nameOf(over) }];
  });

  // --- dragons: those at the lord's court or ridden by someone of the house
  const myHouse = num(me, 'dynasty_house');
  const dragons = save
    .entriesContaining('living', 'ethnicity=dragon')
    .flatMap((id) => {
      const d = character(id);
      const vars = (sub(sub(sub(d, 'alive_data'), 'variables'), 'data')?.values ?? []).filter(isBlock);
      const rider = num(sub(vars.find((v) => str(v, 'flag') === 'current_rider'), 'data'), 'identity');
      const ours = num(sub(d, 'court_data'), 'employer') === playerId || (rider !== undefined && num(character(rider), 'dynasty_house') === myHouse);
      return ours ? [{ name: str(d, 'first_name') ?? '?', age: yearsBetween(str(d, 'birth') ?? date, date), rider: rider !== undefined ? nameOf(rider) : undefined }] : [];
    })
    .sort((a, b) => b.age - a.age);

  // --- wars
  const warIds = save.ids('wars', 2, 'active_wars');
  const wars: WarInfo[] = [];
  let otherWars = 0;
  for (const id of warIds) {
    const w = save.entry('wars', id, 2, 'active_wars');
    if (!w) continue;
    const side = (k: string) => (sub(sub(w, k), 'participants')?.values ?? []).filter(isBlock).map((p) => num(p, 'character')).filter((c): c is number => c !== undefined);
    const [att, def] = [side('attacker'), side('defender')];
    if (!att.includes(playerId) && !def.includes(playerId)) {
      otherWars++;
      continue;
    }
    const cb = sub(w, 'casus_belli');
    const targets = nums(cb, 'targeted_titles').map(titleName).filter(Boolean).join(', ');
    wars.push({
      name: cleanText(str(w, 'name') ?? 'A war'),
      started: str(w, 'start_date') ?? date,
      side: att.includes(playerId) ? 'attacker' : 'defender',
      attackers: att.map(nameOf),
      defenders: def.map(nameOf),
      goal: `${humanize((str(cb, 'type') ?? 'war').replace(/_cb$/, ''))}${targets ? ` for ${targets}` : ''}`,
    });
  }

  // --- alliances and truces
  const allies = new Set<number>();
  const truces: SaveDigest['relations']['truces'] = [];
  for (const v of sub(save.block('relations'), 'active_relations')?.values ?? []) {
    if (!isBlock(v)) continue;
    const [a, b] = [num(v, 'first'), num(v, 'second')];
    if (a === undefined || b === undefined || (a !== playerId && b !== playerId)) continue;
    const other = a === playerId ? b : a;
    if (sub(v, 'alliances')) allies.add(other);
    const latest = v.entries.flatMap((e) => (e.key.startsWith('truce_') && isBlock(e.value) ? [e.value] : [])).sort((x, y) => (str(y, 'date') ?? '').localeCompare(str(x, 'date') ?? ''))[0];
    const until = str(latest, 'date');
    if (until) truces.push({ name: nameOf(other), until, war: cleanText(str(latest, 'name') ?? '') });
  }

  // --- the wider world: independent empires and kingdoms
  const agot = save.entriesContaining('landed_titles', '\tkey=h_the_iron_throne').length > 0;
  const regionOf = (id: number) => {
    const seen = new Set<number>();
    let top = id;
    for (let up = num(title(top), 'de_jure_liege'); up !== undefined && !seen.has(up); up = num(title(top), 'de_jure_liege')) {
      seen.add(up);
      top = up;
    }
    return REGION_BY_TOP[str(title(top), 'key') ?? ''] ?? REGION_ELSE;
  };
  const big_titles = [...new Set([...save.entriesContaining('landed_titles', '\tkey=e_'), ...save.entriesContaining('landed_titles', '\tkey=k_')])];
  // The lands the lord is active in: his own domain and what his vassals hold.
  const homes = new Set(agot ? [...domain, ...big_titles.filter((id) => liegesOf(id).includes(playerId))].map(regionOf) : []);
  const independent = new Set<number>();
  const powers = big_titles
    .flatMap((id) => {
      const t = title(id);
      const holder = num(t, 'holder');
      if (holder === undefined || holder === playerId || num(t, 'de_facto_liege') !== undefined || independent.has(holder)) return [];
      const c = character(holder);
      // A title without counties, baronies or vassals is no power, whatever troops the save gives its holder.
      const land = nums(sub(c, 'landed_data'), 'domain');
      if (land.length && !nums(sub(c, 'landed_data'), 'vassal_contracts').length && !land.some((d) => /^[cb]_/.test(str(title(d), 'key') ?? ''))) return [];
      independent.add(holder);
      return [{ title: titleName(id) ?? '?', ruler: str(c, 'first_name') ?? '?', house: houseName(num(c, 'dynasty_house')), strength: Math.round(num(sub(c, 'landed_data'), 'strength') ?? 0), region: agot ? regionOf(id) : undefined, allied: allies.has(holder) }];
    })
    .sort((a, b) => b.strength - a.strength);
  const relevant = (p: (typeof powers)[number]) => !homes.size || p.allied || homes.has(p.region ?? '');
  const neighbours = powers.filter(relevant).map(({ allied: _, ...p }) => p);
  const distant = agot ? [...new Set(powers.filter((p) => !relevant(p)).map((p) => p.region!))] : [];

  // --- house
  const house = houseBlock(myHouse ?? -1);
  const parentHouse = houseName(num(house, 'parent_dynasty_house'));
  const dynastyKey = str(save.entry('dynasties', num(house, 'dynasty') ?? -1, 0, 'dynasties'), 'key');
  const motto = str(house, 'motto');

  return {
    date,
    startDate,
    gameVersion: str(save.block('meta_data'), 'version') ?? '',
    ruler: {
      ...person(playerId)!,
      reignStart: str(landed, 'became_ruler_date'),
      gold: num(sub(alive, 'gold'), 'value') ?? 0,
      prestige: currency('prestige'),
      piety: currency('piety'),
      dread: num(landed, 'dread') ?? 0,
      legitimacy: num(playable, 'legitimacy'),
      focus: str(sub(alive, 'focus'), 'type'),
      perks: words(alive, 'perk').length,
      location: titleName(num(sub(alive, 'location'), 'location')),
    },
    house: {
      name: houseName(myHouse) ?? 'lowborn',
      motto: motto ? (localize(motto) ?? (motto.endsWith('_motto') ? undefined : motto)) : undefined,
      founded: str(house, 'found_date'),
      parent: parentHouse,
      dynasty: dynastyKey ? loc(dynastyKey) : undefined,
      arms: undefined,
    },
    family: {
      parents: relatives(parents),
      siblings: relatives(siblings),
      spouses: relatives(all(fam, 'spouse').filter((v): v is number => typeof v === 'number')),
      formerSpouses: relatives(nums(fam, 'former_spouses')),
      children: relatives(nums(fam, 'child')),
      heirs: nums(landed, 'succession').slice(0, 5).map(person).filter((p): p is Person => !!p),
    },
    relations: {
      rivals: open('became_rivals', 'rival', ['stopped_being_rivals', 'rival_died']),
      friends: open('became_friends', 'new_relation', ['friend_died', 'stopped_being_friends']),
      lovers: open('became_lovers', 'new_relation', ['stopped_being_lovers', 'lover_died']),
      allies: [...allies].map(nameOf),
      truces,
    },
    realm: {
      titles: big,
      counts,
      capital: titleName(num(landed, 'realm_capital')),
      government: str(landed, 'government'),
      laws: words(landed, 'laws').map((l) => localize(l) ?? humanize(l)),
      troops: Math.round(num(landed, 'strength') ?? 0),
      levy: Math.round(num(landed, 'levy') ?? 0),
      vassals: vassals.slice(0, 15),
      council,
      court,
      claims,
    },
    dragons,
    wars,
    otherWars,
    neighbours: agot ? neighbours : neighbours.slice(0, 15),
    distant,
    story,
    recent,
    world: { living: save.ids('living').length, dead: save.ids('dead_unprunable').length + save.ids('characters').length },
  };
}

// --- as text for the prompt -----------------------------------------------------------------------

export const personLine = (p: Person) =>
  `${p.name}${p.nickname ? ` "${p.nickname}"` : ''}${p.house ? ` of House ${p.house}` : ''}, ${p.death ? `died ${year(p.death)} aged ${p.age}` : `age ${p.age}`}`;
const relativeLine = (r: Relative) =>
  `${personLine(r)}${r.traits.length ? `; ${r.traits.slice(0, 6).join(', ')}` : ''}${r.spouses?.length ? `; married to ${r.spouses.join(', ')}` : ''}${r.betrothedTo ? `; betrothed to ${r.betrothedTo}` : ''}`;
const section = (title: string, lines: (string | undefined | false)[]) => {
  const body = lines.filter(Boolean);
  return body.length ? `## ${title}\n${body.join('\n')}` : '';
};
const list = (items: string[]) => items.map((i) => `- ${i}`);

/** The arms of the lord's house as the game shows them, and the frame that gives the shield its shape. */
export function saveArms(save: SaveData): { script: string; frame?: string } | undefined {
  const meta = save.block('meta_data');
  const arms = sub(meta, 'meta_house_coat_of_arms') ?? sub(meta, 'meta_coat_of_arms');
  return arms && { script: serializeCoa(coaFromBlock(arms)), frame: str(meta, 'frame') };
}

/** The digest as compact text for the Maester's prompt. */
export function digestToText(d: SaveDigest): string {
  const r = d.ruler;
  const inner = d.realm.claims.filter((c) => c.inRealm);
  const outer = d.realm.claims.filter((c) => !c.inRealm);
  const power = (n: SaveDigest['neighbours'][number]) => `${n.title}: ${n.ruler}${n.house ? ` of House ${n.house}` : ''}, troops ${n.strength}`;
  const skills = r.skills ? Object.entries(r.skills).map(([k, v]) => `${k} ${v}`).join(', ') : '';
  return [
    `# Campaign state on ${formatDate(d.date)} (campaign started ${formatDate(d.startDate)})`,
    section('Your lord', [
      personLine(r),
      r.reignStart && `Ruling since ${formatDate(r.reignStart)}.`,
      `Traits: ${r.traits.join(', ')}`,
      skills && `Skills: ${skills}`,
      `Gold ${Math.round(r.gold)}, prestige ${Math.round(r.prestige)}, piety ${Math.round(r.piety)}, dread ${Math.round(r.dread)}${r.legitimacy !== undefined ? `, legitimacy ${Math.round(r.legitimacy)}` : ''}`,
      r.location && `Currently at ${r.location}.`,
    ]),
    section('House', [
      `House ${d.house.name}${d.house.dynasty ? ` of dynasty ${d.house.dynasty}` : ''}${d.house.parent ? `, branch of House ${d.house.parent}` : ''}${d.house.founded ? `, founded ${year(d.house.founded)}` : ''}.`,
      d.house.motto && `Words: "${d.house.motto}"`,
    ]),
    section('Family', [
      ...list(d.family.parents.map((p) => `Parent: ${relativeLine(p)}`)),
      ...list(d.family.spouses.map((p) => `Spouse: ${relativeLine(p)}`)),
      ...list(d.family.formerSpouses.map((p) => `Former spouse: ${relativeLine(p)}`)),
      ...list(d.family.children.map((p) => `Child: ${relativeLine(p)}`)),
      ...list(d.family.siblings.map((p) => `Sibling: ${personLine(p)}`)),
      d.family.heirs.length > 0 && `Line of succession: ${d.family.heirs.map((h) => `${h.name} (${h.age})`).join(', ')}`,
    ]),
    section('Relations (from memories, may be incomplete)', [
      d.relations.rivals.length > 0 && `Rivals: ${d.relations.rivals.join(', ')}`,
      d.relations.friends.length > 0 && `Friends: ${d.relations.friends.join(', ')}`,
      d.relations.lovers.length > 0 && `Lovers: ${d.relations.lovers.join(', ')}`,
      d.relations.allies.length > 0 && `Allies: ${d.relations.allies.join(', ')}`,
      d.relations.truces.length > 0 && `Truces, which forbid attacking until they end: ${d.relations.truces.map((t) => `${t.name} until ${formatDate(t.until)}${t.war ? ` (${t.war})` : ''}`).join('; ')}`,
    ]),
    section('Dragons of the realm', list(d.dragons.map((x) => `${x.name}, age ${x.age}, ${x.rider ? `ridden by ${x.rider}` : 'no rider'}`))),
    section('Realm', [
      `Titles: ${d.realm.titles.filter((t) => t.tier !== 'duchy').map((t) => `${t.name} (${t.tier})`).join(', ')}`,
      `Holds ${Object.entries(d.realm.counts).map(([k, v]) => `${v} ${v === 1 ? k : k.replace(/y$/, 'ie') + 's'}`).join(', ')} directly.`,
      d.realm.capital && `Capital: ${d.realm.capital}. Government: ${humanize(d.realm.government ?? '')}.`,
      `Troops ${d.realm.troops} (levies ${d.realm.levy}).`,
      `Laws: ${d.realm.laws.join(', ')}`,
      d.realm.council.length > 0 && `Council (current tasks): ${d.realm.council.map((c) => `${c.position}: ${c.name}`).join('; ')}`,
      d.realm.court.length > 0 && `Court: ${d.realm.court.map((c) => `${c.position}: ${c.name}`).join('; ')}`,
      d.realm.vassals.length > 0 && `Strongest vassals: ${d.realm.vassals.map((v) => `${v.name}${v.title ? ` (${v.title})` : ''} ${v.strength}`).join('; ')}`,
      inner.length > 0 && `Claims inside your lord's own realm, no use against outsiders and not worth raising unless asked: ${inner.map((c) => `${c.name} (${c.holder ?? 'no holder'}, ${c.over ? `under ${c.over}` : 'direct vassal'})`).join(', ')}`,
      outer.length > 0 && `Claims on titles outside the realm: ${outer.map((c) => `${c.name} (${c.holder ?? 'no holder'}${c.over ? `, realm of ${c.over}` : ''})`).join(', ')}`,
    ]),
    section('Wars of your lord', [
      ...list(d.wars.map((w) => `${w.name} (since ${year(w.started)}), your lord is ${w.side}. ${w.attackers.join(', ')} against ${w.defenders.join(', ')}. Goal: ${w.goal}.`)),
      d.wars.length === 0 && 'At peace.',
      `${d.otherWars} other wars are being fought in the world.`,
    ]),
    ...[...new Set(d.neighbours.map((n) => n.region))].map((region) =>
      section(region ? `All other independent powers: ${region}` : 'Other independent powers', list(d.neighbours.filter((n) => n.region === region).map(power))),
    ),
    d.distant.length > 0 && `Left out, because your lord has no land or allies there and they hardly matter to him: the powers of ${d.distant.join(' and ')}. Consult them by name if he asks.`,
    section('The story so far', d.story.flatMap((s) => [
      `### ${personLine(s.person)} (ruler from ${year(s.from)})${s.person.deathReason ? `; ${s.person.deathReason}` : ''}`,
      Object.keys(s.totals).length ? Object.entries(s.totals).map(([k, v]) => `${v} ${v === 1 ? k.replace(/s\b/, '') : k}`).join(', ') : undefined,
      ...list(s.events.map((e) => `${year(e.date)}: ${e.text}`)),
    ])),
    section('Recent events (last 10 years)', list(d.recent.map((e) => `${formatDate(e.date)}: ${e.text}`))),
  ].filter(Boolean).join('\n\n');
}
