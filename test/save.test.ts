import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { IdeaSnapshot } from '../src/core/ai/inspire.ts';
import type { LlmProvider } from '../src/core/ai/provider.ts';
import { maesterAnswer, newChat, readingGreeting } from '../src/core/maester/maester.ts';
import { SaveRecords } from '../src/core/save/lookup.ts';
import { armsFromHead, buildSaveDigest, cleanText, digestToText, saveArms, saveReader } from '../src/core/save/digest.ts';
import { SaveData, SaveFormatError, unpackSave } from '../src/core/save/save-file.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

const GAMESTATE = `meta_data={
\tversion="1.19.0.6"
\tframe="house_frame_val1"
\tmeta_house_coat_of_arms={
\t\tpattern="pattern_solid.dds"
\t\tcolor1=agot_gold
\t\tcolored_emblem={
\t\t\tcolor1=agot_black
\t\t\ttexture="acs_targaryen.dds"
\t\t}
\t}
}
date=8253.7.6
bookmark_date=8132.1.1
traits_lookup={ brave lifestyle_reveler }
played_character={
\tcharacter=1
\tlegacy={ {
\t\t\tcharacter=2
\t\t\tdate=8132.1.1
\t\t}
 {
\t\t\tcharacter=1
\t\t\tdate=8244.7.27
\t\t}
 }
}
living={
1={
\tfirst_name="Jacaerys"
\tbirth=8199.2.11
\tdynasty_house=5
\tskill={ 8 7 10 6 7 19 }
\ttraits={ 0 }
\tfamily_data={
\t\tspouse=3
\t\tchild={ 4 }
\t}
\talive_data={
\t\tclaim={ { title=21 } { title=22 } { title=23 } }
\t\tgold={
\t\t\tvalue=100.5
\t\t}
\t\tmemories={ 10 11 }
\t}
\tlanded_data={
\t\tdomain={ 20 }
\t\tstrength=500
\t\trealm_capital=20
\t\tlaws={ single_heir_succession_law }
\t}
}
3={
\tfirst_name="Daenerys"
\tbirth=8195.4.2
\tfemale=yes
}
4={
\tfirst_name="Aelon"
\tbirth=8247.5.30
\tfamily_data={
\t\tbetrothed=3
\t}
}
9={
\tfirst_name="Bernarr"
\tbirth=8200.1.1
\tlanded_data={
\t\tdomain={ 28 }
\t\tstrength=3594
\t}
}
6={
\tfirst_name="Rhaegal"
\tbirth=8210.4.23
\tethnicity=dragon
\tcourt_data={
\t\temployer=1
\t}
}
}
dead_unprunable={
2={
\tfirst_name="Rhaegar"
\tbirth=8107.1.1
\tfamily_data={
\t\tchild={ 1 }
\t}
\tdead_data={
\t\tdate=8203.3.5
\t\treason=blind
\t}
}
}
character_memory_manager={
\tdatabase={
\t\t10={
\t\t\ttype=married
\t\t\tparticipants={
\t\t\t\tspouse=3
\t\t\t}
\t\t\tcreation_date=8250.2.18
\t\t}
\t\t11={
\t\t\ttype=ascended_throne_memory
\t\t\tparticipants={
\t\t\t\tflavor_character=1
\t\t\t}
\t\t\tcreation_date=8251.1.1
\t\t}
\t}
}
artifacts={
	artifacts={
		70={
			name="Red Dragon Egg"
			modifiers={ dragon_egg_modifier }
			owner=1
		}
		71={
			name="Obsidian Dragon Egg"
			modifiers={ dud_egg_modifier }
			owner=4
		}
		72={
			name="Old Sword"
			owner=1
		}
	}
}
relations={
	active_relations={ {
			first=1
			second=4
			alliances={ {
					allied_through_0=1
					allied_through_1=4
				}
 }
		}
 {
			first=2
			second=1
			truce_0={
				date=8255.1.1
				name="Conquest of Dorne"
				result=defeat
			}
		}
 {
			first=2
			second=3
		}
 }
}
landed_titles={
20={
\tkey=e_the_stormlands
\tholder=1
\ttitle_name_data={
\t\tname="The Stormlands"
\t}
\tde_jure_liege=30
}
21={
\tkey=k_southstone
\tholder=3
\tde_facto_liege=20
\ttitle_name_data={
\t\tname="Southstone"
\t}
}
22={
\tkey=d_denslane
\tholder=4
\tde_facto_liege=24
\ttitle_name_data={
\t\tname="Deep Den"
\t}
}
23={
\tkey=k_sunspear
\tholder=3
\tde_facto_liege=25
\ttitle_name_data={
\t\tname="Sunspear"
\t}
}
24={
\tkey=e_the_westerlands
\tholder=3
\tde_facto_liege=20
\tde_jure_liege=30
\ttitle_name_data={
\t\tname="The Westerlands"
\t}
}
25={
\tkey=e_dorne
\tholder=2
\tde_jure_liege=30
\ttitle_name_data={
\t\tname="Dorne"
\t}
}
26={
\tkey=k_myr
\tholder=4
\tde_jure_liege=27
\ttitle_name_data={
\t\tname="Myr"
\t}
}
27={
\tkey=e_narrow_sea
}
28={
\tkey=k_harrenhal
\tholder=9
\tde_jure_liege=30
\ttitle_name_data={
\t\tname="Harrenhal"
\t}
}
30={
\tkey=h_the_iron_throne
\tholder=1
}
}
dynasties={
\tdynasty_house={
5={
\tlocalized_name="Stormfyre"
\tdynasty=7
\tmotto="From the Vine to the Storm"
}
}
\tdynasties={
7={
\tkey=dynn_Targaryen
}
}
}
wars={
\tactive_wars={
\t}
}
`;

describe('save files', () => {
  it('refuses binary and foreign files with a clear message', () => {
    expect(() => unpackSave(bytes('hello\nworld'))).toThrow(SaveFormatError);
    expect(() => unpackSave(bytes('SAV0101365da3af00000000\nU1\x01\x00'))).toThrow(/binary format/);
  });

  it('accepts a save whose gamestate follows the header as text', () => {
    expect(new TextDecoder().decode(unpackSave(bytes(`SAV010012345678${'00000000'}\n${GAMESTATE}`))).startsWith('meta_data')).toBe(true);
  });

  it('finds sections and entries without parsing everything', () => {
    const s = new SaveData(bytes(GAMESTATE));
    expect(s.scalar('date')).toBe('8253.7.6');
    expect(s.ids('living').sort()).toEqual([1, 3, 4, 6, 9]);
    expect(s.entriesContaining('living', 'ethnicity=dragon')).toEqual([6]);
    expect(s.ids('dynasties', 0, 'dynasties')).toEqual([7]);
    expect(s.ids('dynasties', 0, 'dynasty_house')).toEqual([5]);
  });

  it('removes the game markup from war names', () => {
    expect(cleanText('2nd ONCLICK:TITLE,519 TOOLTIP:LANDED_TITLE,519 L; Rotting Ice!!! Clash!! against ONCLICK:TITLE,461 TOOLTIP:LANDED_TITLE,461 L; White Bear Slope!!!')).toBe('2nd Rotting Ice Clash against White Bear Slope');
  });

  it('builds the digest', () => {
    const d = buildSaveDigest(new SaveData(bytes(GAMESTATE)), (k) => ({ trait_brave: 'Brave', dynn_Targaryen: 'Targaryen', blind: 'tripped and fell to [CHARACTER.GetHerHis] death' })[k]);
    expect(d.ruler).toMatchObject({ name: 'Jacaerys', age: 54, house: 'Stormfyre', gold: 100.5, traits: ['Brave'] });
    expect(d.house).toMatchObject({ name: 'Stormfyre', dynasty: 'Targaryen', motto: 'From the Vine to the Storm' });
    expect(d.family.parents.map((p) => p.name)).toEqual(['Rhaegar']);
    expect(d.family.children[0]).toMatchObject({ name: 'Aelon', betrothedTo: 'Daenerys' });
    expect(d.dragons).toEqual([{ name: 'Rhaegal', age: 43, rider: undefined }]);
    expect(d.realm.titles).toEqual([{ tier: 'empire', name: 'The Stormlands' }]);
    const text = digestToText(d);
    expect(text).toContain('Campaign state on 6 July 253 AC');
    expect(text).toContain('; tripped and fell to his death');
    expect(text).toContain('took a new, higher title');
    expect(text).toContain('At peace.');
    expect(d.realm.claims.map((c) => c.inRealm)).toEqual([true, true, false]);
    expect(text).toMatch(/Claims inside your lord's own realm[^\n]*Southstone \([^,]+, direct vassal\), Deep Den \([^,]+, under [^)]+\)/);
    expect(text).toMatch(/Claims on titles outside the realm: Sunspear \([^)]*, realm of /);
    expect(text).toMatch(/All other independent powers: Westeros\n- Dorne: /);
    expect(text).toMatch(/Allies: /);
    expect(text).toMatch(/Truces, which forbid attacking until they end: [^\n]* until 1 January 255 AC \(Conquest of Dorne\)/);
    // Myr is held by an ally, so it stays although the lord has no land abroad.
    expect(text).toMatch(/All other independent powers: Essos and other lands\n- Myr: /);
    expect(d.distant).toEqual([]);
    expect(text).toContain('Held by your lord: Red Dragon Egg');
    expect(text).toMatch(/Elsewhere: Obsidian Dragon Egg \(petrified\), held by /);
    expect(text).not.toContain('Old Sword');
    // A title without land is no power.
    expect(text).not.toContain('Harrenhal');
    const save = new SaveData(bytes(GAMESTATE));
    expect(new SaveRecords(save, saveReader(save)).lookup('Jacaerys')).toContain('Artifacts: Red Dragon Egg, Old Sword');
    const arms = saveArms(new SaveData(bytes(GAMESTATE)));
    expect(arms).toMatchObject({ frame: 'house_frame_val1', script: expect.stringContaining('acs_targaryen.dds') });
    expect(armsFromHead(GAMESTATE)).toEqual(arms);
    // A file start that ends inside the arms gives none, rather than half a shield.
    expect(armsFromHead(GAMESTATE.slice(0, GAMESTATE.indexOf('acs_targaryen')))).toBeUndefined();
  });
});

const REAL = 'dev-saves/Stormfyre/Stormfyre.ck3';
describe.skipIf(!existsSync(REAL))('a real save', () => {
  it('reads the campaign, in a prompt-sized digest', () => {
    const d = buildSaveDigest(new SaveData(unpackSave(readFileSync(REAL))));
    expect(d.ruler.name).toBe('Jacaerys');
    expect(d.story.length).toBe(4);
    expect(digestToText(d).length).toBeLessThan(25_000);
  }, 60_000);
});

describe('the Maester without a save', () => {
  it('greets without an AI call, and does not consult records it does not have', async () => {
    const chat = newChat('x');
    expect(chat.messages.map((m) => m.role)).toEqual(['maester']);
    const prompts: string[] = [];
    let records = 0;
    const provider = {
      id: 'test',
      supportsImages: false,
      generateJson: async (req: { prompt: string }) => {
        prompts.push(req.prompt);
        return { reply: 'As you wish.', consult: ['Daerella'], wiki: [] };
      },
    };
    const reply = await maesterAnswer(provider, { ...chat, messages: [...chat.messages, { role: 'lord', text: 'Hello', at: '' }] }, {
      records: async () => {
        records++;
        return '';
      },
    });
    expect(reply.text).toBe('As you wish.');
    expect(records).toBe(0);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('You have not read a save');
  });

  it('knows the chosen scenario as the plan, with or without a save', async () => {
    const prompts: string[] = [];
    const provider = { generateJson: async (r: { prompt: string }) => (prompts.push(r.prompt), { reply: 'Very well.', consult: [], wiki: [] }) } as unknown as LlmProvider;
    const scenario = { title: 'The Warg King Returns', concept: 'Rebuild the Point.', canon: '', fit: '', startNote: 'Free start', region: 'north', house: { kind: 'new', name: 'Wargholt' }, rules: [], sigil: '', words: '', catch: '', difficulty: 'hard', notes: [] } as IdeaSnapshot;
    const chat = newChat('x');
    chat.scenario = scenario;
    chat.messages.push({ role: 'scenario', text: scenario.title, at: '' }, { role: 'lord', text: 'Was nun?', at: '' });
    await maesterAnswer(provider, chat, { records: async () => '' });
    expect(prompts[0]).toContain('The scenario the lord set out to play');
    expect(prompts[0]).toContain('Concept: Rebuild the Point.');
    expect(prompts[0]).toContain('You have not read a save');
    expect(prompts[0]).toContain('[The lord chose the scenario "The Warg King Returns".]');
  });

  it('shows screenshots with their own message in every round, and later only notes them', async () => {
    const requests: { prompt: string; images?: unknown[] }[] = [];
    const answers = [{ reply: '', consult: ['Daerella'], wiki: [] }, { reply: 'I see it.', consult: [], wiki: [] }];
    const provider = { generateJson: async (r: { prompt: string; images?: unknown[] }) => (requests.push(r), answers.shift()) } as unknown as LlmProvider;
    const chat = newChat('x');
    chat.notes = 'Notes';
    chat.messages.push({ role: 'lord', text: '', at: '', images: ['data:image/jpeg;base64,x'] });
    const image = { mediaType: 'image/jpeg' as const, base64: 'abc' };
    await maesterAnswer(provider, chat, { records: async () => 'Record', images: [image] });
    expect(requests.map((r) => r.images)).toEqual([[image], [image]]);
    expect(requests[0]!.prompt).toContain('Lord:  [attached a screenshot]');
    expect(requests[0]!.prompt).not.toContain('data:image');
    await maesterAnswer({ ...provider, generateJson: async (r: { images?: unknown[] }) => (requests.push(r as never), { reply: 'Ok', consult: [], wiki: [] }) } as LlmProvider, chat, { records: async () => '' });
    expect(requests.at(-1)!.images).toBeUndefined();
  });

  it('greets by the address of the save after reading it', () => {
    const who = { address: 'King Jacaerys', nickname: 'the Bellower', house: 'Stormfyre', realm: 'Seven Kingdoms of The Iron Throne', date: '14 December 263 AC', known: false };
    expect(readingGreeting(who)).toBe(
      'Hail, King Jacaerys the Bellower of House Stormfyre. The records of the Seven Kingdoms of The Iron Throne lie open before me, as they stood on 14 December 263 AC. How may I serve you?',
    );
    expect(readingGreeting({ ...who, realm: 'The Stormlands' })).toContain('The records of The Stormlands lie');
    expect(readingGreeting({ address: 'Ser Robb', date: '1 AC', known: false })).toBe('Hail, Ser Robb. Your records lie open before me, as they stood on 1 AC. How may I serve you?');
    expect(readingGreeting({ ...who, known: true })).toBe('Ah, so this is where we left off, King Jacaerys: 14 December 263 AC. What news do you bring?');
  });
});
