// The Citadel: an open conversation about what to play next, with the Archmaester. He knows what the playset offers,
// looks up houses, bookmarks and rules there and lore in A Wiki of Ice and Fire. "Generate scenarios" then turns the
// conversation into the idea cards of core/ai/inspire.ts.

import { bookmarkLines, promptRules, regionLines, type IdeaSnapshot } from './ai/inspire.ts';
import type { WikiArticle } from './ai/canon.ts';
import type { LlmProvider } from './ai/provider.ts';
import { bookmarkYear, type Catalog } from './catalog/catalog.ts';
import { advisorAnswer, conversation, type ChatLog, type MaesterMessage } from './maester/maester.ts';

export interface CitadelChat extends ChatLog {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The scenarios drawn up so far, newest first. */
  ideas: IdeaSnapshot[];
  ranking?: string;
  /** Titles of the scenarios already saved to the Collection. */
  savedIdeas?: string[];
}

const SYSTEM = `You are the Archmaester at the Citadel in Oldtown, advising a player of Crusader Kings III with the A Game of Thrones mod who is deciding what to play next.
Voice: a learned old scholar with dry wit, lightly in character. Give clear, concrete answers: which year fits, which house, which goals, and why. Keep answers short unless asked for more. When the wish is still vague, ask one good question rather than many. Answer in the language the player writes in. Write plain text without markdown.

Truth:
- What the playset offers (bookmarks, houses, game rules) is in your lists and records. Never invent a bookmark, house or rule; a free start date can be any year in the range given.
- For lore (history, places, people) A Wiki of Ice and Fire counts, not the TV show. Consult it rather than guess at names and dates.
- Say so when something is your own invention or opinion, and when you are unsure what the mod can do.

Consulting: to look something up, return its name in "consult" (a house, a bookmark or a game rule) or an article title in "wiki", with an empty "reply". You get the results and answer then. At most 3 names at a time, and only when you need them. When you can answer, return the answer in "reply" and leave both lists empty.

When the player seems to know what they want, you may mention that the "Generate scenarios" button above the conversation draws up full scenarios from your talk.`;

const GREETING = 'Welcome to the Citadel. I am the Archmaester, and every age of Westeros lies in these stacks. What do you have a mind to play: a house, a place, an age, a kind of tale? When we have it, I will draw up scenarios for you.';

export function newCitadelChat(id: string): CitadelChat {
  const at = new Date().toISOString();
  return { id, title: 'New conversation', createdAt: at, updatedAt: at, ideas: [], messages: [{ role: 'maester', at, text: GREETING }] };
}

/** What the Archmaester always knows: the playset, in short. Details come as records. */
export function citadelBackground(catalog: Catalog): string {
  const rules = promptRules(catalog).map((r) => r.name.replace(/^AGOT:\s*/i, ''));
  return [
    `Bookmarks in this playset (key: date "name"):\n${bookmarkLines(catalog)}`,
    `Regions (id: some houses there):\n${regionLines(catalog)}`,
    `AGOT game rules (consult one for its options): ${rules.join('; ').slice(0, 4000)}`,
  ].join('\n\n');
}

const normal = (s: string) => s.trim().replace(/^house\s+/i, '').toLowerCase();

/** What the playset says about a house, bookmark or game rule. */
export function citadelRecord(catalog: Catalog, query: string): string {
  const q = normal(query);
  if (!q) return 'No name given.';
  const houses = [...catalog.dynasties.values()];
  const house = houses.find((d) => d.name.toLowerCase() === q && catalog.coas.has(d.key)) ?? houses.find((d) => d.name.toLowerCase() === q);
  if (house) {
    const branches = houses.filter((d) => d.dynasty === house.key).map((d) => d.name);
    const parent = house.dynasty && catalog.dynasties.get(house.dynasty)?.name;
    const featured = catalog.bookmarks.filter((b) => b.characters.some((c) => c.dynasty === house.key));
    return [
      `Record of House ${house.name}`,
      `Region: ${house.group}${house.culture ? `, culture ${house.culture}` : ''}`,
      house.mottos[0] && `Words: ${house.mottos[0]}`,
      parent && `A branch of House ${parent}`,
      branches.length > 0 && `Branches: ${branches.slice(0, 12).join(', ')}`,
      featured.length > 0 && `Featured in the bookmarks: ${featured.map((b) => `${bookmarkYear(b.startDate)} "${b.name}"`).join(', ')}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  const bookmark = catalog.bookmarks.find((b) => b.key.toLowerCase() === q || b.name.toLowerCase() === q);
  if (bookmark) {
    return [
      `Bookmark ${bookmarkYear(bookmark.startDate)} "${bookmark.name}"`,
      bookmark.description.replace(/\s+/g, ' '),
      bookmark.characters.length > 0 && `Featured: ${bookmark.characters.map((c) => [c.name, c.dynasty && catalog.dynasties.get(c.dynasty)?.name, c.title].filter(Boolean).join(', ')).join('; ')}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  const rule = promptRules(catalog).find((r) => r.key.toLowerCase() === q || r.name.replace(/^AGOT:\s*/i, '').toLowerCase() === q);
  if (rule) return `Game rule "${rule.name}": ${rule.options.map((o) => o.name).join(', ')}`;
  const near = houses.filter((d) => d.name.toLowerCase().includes(q) && catalog.coas.has(d.key)).slice(0, 8).map((d) => d.name);
  return near.length ? `No exact record of "${query}". Houses with similar names: ${near.join(', ')}` : `No record of "${query}" in this playset.`;
}

/** Answers the last message. */
export function citadelAnswer(
  provider: LlmProvider,
  chat: CitadelChat,
  catalog: Catalog,
  tools: { wiki?: (titles: string[]) => Promise<WikiArticle[]>; onStep?: (text: string) => void },
): Promise<MaesterMessage> {
  return advisorAnswer(provider, chat, {
    ...tools,
    records: async (name) => citadelRecord(catalog, name),
    label: 'citadel',
    system: SYSTEM,
    who: 'The Archmaester',
    advisor: 'Archmaester',
    background: citadelBackground(catalog),
  });
}

/** The conversation as the wish for the scenarios. */
export function citadelBrief(chat: CitadelChat): string {
  return [chat.summary, conversation(chat, 'Archmaester')].filter(Boolean).join('\n\n');
}

/** Marks in the conversation which scenarios were drawn up, so the Archmaester can talk about them. */
export function scenariosMessage(ideas: IdeaSnapshot[]): MaesterMessage {
  return { role: 'scenarios', at: new Date().toISOString(), titles: ideas.map((i) => i.title), text: ideas.map((i, n) => `${n + 1}. ${i.title}: ${i.concept}`).join('\n') };
}

/** A chat's name, from the first thing the player said. */
export function chatTitle(text: string): string {
  const line = text.trim().split('\n')[0]!;
  return line.length > 48 ? `${line.slice(0, 48).trimEnd()}…` : line;
}
