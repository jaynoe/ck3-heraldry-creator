// The Maester: a chat about a running campaign. His knowledge comes from a digest of a save ("notes"); when he
// needs more he asks for records from the save or articles from A Wiki of Ice and Fire, and answers once he has them.

import type { WikiArticle } from '../ai/canon.ts';
import type { LlmProvider } from '../ai/provider.ts';

export interface MaesterMessage {
  role: 'lord' | 'maester' | 'reading';
  text: string;
  at: string;
  /** Records the Maester looked at for this answer. */
  consulted?: string[];
  /** Wiki articles behind this answer. */
  sources?: { title: string; url: string }[];
  /** For a reading: the save file and its in-game date. */
  file?: string;
  saveDate?: string;
  /** For a reading: what changed since the reading before. */
  changes?: string[];
}

export interface MaesterChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The save the notes come from; empty until one was read. */
  file: string;
  /** Digest of the last save read; empty until one was read. */
  notes: string;
  /** The arms of the lord's house, from the last save read. */
  arms?: { script: string; frame?: string };
  /** What older messages said, once the conversation got long. */
  summary?: string;
  /** Messages before this index are covered by the summary. */
  summarized?: number;
  messages: MaesterMessage[];
}

const SYSTEM = `You are the Maester of a noble house in a Crusader Kings III campaign with the A Game of Thrones mod. You serve the player's ruler as advisor, chronicler and companion.
Voice: lightly in character. Address the player as your lord or lady, with a Maester's dry wit and care. But give clear, concrete advice, and speak plainly about game mechanics, rules and numbers when that is what helps. Keep answers short unless asked for more. Take part in what happens: react to the lord's news, remember it and ask about it now and then.
Answer in the language the player writes in. Write plain text without markdown.

Truth:
- Your notes and the records are the facts of THIS campaign. Never invent people, events, numbers or relations. If you do not know something, say so or consult a record.
- This campaign has long since left the canon of the books. For what happens in the campaign the save counts, even against the wiki. For lore (history, places, customs of the world) A Wiki of Ice and Fire counts.
- The lord can be wrong or forget things. Check what he says against your notes and the records. When it does not fit, say so plainly before you build on it: a power he left out, a number that is off, someone he thinks alive who is dead. The lists of independent powers in your notes are complete for the lands he is active in, so use them when he asks who stands in his way. Respect his truces and allies when you advise on war.
- Mark your own opinions and guesses as such. The player may tell you things the save cannot show, such as plans and reasons: believe and remember them.
- You only know the state of the last save you read; if the lord seems further along, ask him to let you read a newer one. If you have read no save yet, you know only what the lord tells you, and may offer to read one ("Read a save" above the conversation).

Consulting: to look something up, return its name in "consult" (a person with their house if known, "House X", or a title) or an article title in "wiki", with an empty "reply". You get the results and answer then. Consult rather than guess, but only when you need it: at most 3 names at a time. When you can answer, return the answer in "reply" and leave both lists empty.`;

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'your answer to the lord; empty while you consult' },
    consult: { type: 'array', items: { type: 'string' }, description: 'names to look up in the save' },
    wiki: { type: 'array', items: { type: 'string' }, description: 'articles of A Wiki of Ice and Fire to look up' },
  },
  required: ['reply', 'consult', 'wiki'],
  additionalProperties: false,
};

const SUMMARY_SCHEMA = { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false };

const MAX_ROUNDS = 2;
const MAX_NAMES = 3;
const KEEP_CHARS = 30_000;
const KEEP_MESSAGES = 10;

function conversation(chat: MaesterChat): string {
  return chat.messages
    .slice(chat.summarized ?? 0)
    .map((m) => {
      if (m.role === 'reading') {
        const changes = m.changes?.length ? ` What changed since the last reading:\n${m.changes.join('\n')}` : '';
        return `[You read the save ${m.file} and updated your notes.${changes}]`;
      }
      return `${m.role === 'lord' ? 'Lord' : 'Maester'}: ${m.text}`;
    })
    .join('\n\n');
}

export interface MaesterTools {
  /** Looks up a person, house or title in the save. */
  records: (name: string) => Promise<string>;
  wiki?: (titles: string[]) => Promise<WikiArticle[]>;
  /** What the Maester is doing right now, for the UI. */
  onStep?: (text: string) => void;
}

/** Answers the last message of the chat, consulting records and the wiki on the way. */
export async function maesterAnswer(provider: LlmProvider, chat: MaesterChat, tools: MaesterTools): Promise<MaesterMessage> {
  const consulted: string[] = [];
  const sources = new Map<string, { title: string; url: string }>();
  const found: string[] = [];
  for (let round = 0; ; round++) {
    const last = round >= MAX_ROUNDS;
    const prompt = [
      chat.notes ? `Your notes on the campaign:\n${chat.notes}` : 'You have not read a save of this campaign yet, so you have no notes and no records to consult.',
      chat.summary && `What was said earlier in this conversation:\n${chat.summary}`,
      `The conversation:\n${conversation(chat)}`,
      found.length > 0 && `What you looked up for this answer:\n${found.join('\n\n')}`,
      last ? 'Answer the lord now with what you have; do not consult any further.' : 'Answer the lord, or consult first if you need to.',
    ]
      .filter(Boolean)
      .join('\n\n');
    tools.onStep?.(round === 0 ? 'Your Maester considers the matter…' : 'Your Maester weighs what he found…');
    const r = (await provider.generateJson({ label: 'maester', system: SYSTEM, prompt, schema: SCHEMA })) as { reply: string; consult: string[]; wiki: string[] };
    const names = last || !chat.notes ? [] : r.consult.slice(0, MAX_NAMES);
    const articles = last || !tools.wiki ? [] : r.wiki.slice(0, MAX_NAMES);
    if (!names.length && !articles.length) {
      return { role: 'maester', text: r.reply.trim(), at: new Date().toISOString(), consulted: consulted.length ? consulted : undefined, sources: sources.size ? [...sources.values()] : undefined };
    }
    for (const name of names) {
      tools.onStep?.(`Your Maester sends for the records of ${name}…`);
      found.push(await tools.records(name));
      consulted.push(name);
    }
    if (articles.length) {
      tools.onStep?.('Your Maester consults A Wiki of Ice and Fire…');
      try {
        for (const a of await tools.wiki!(articles)) {
          found.push(`From A Wiki of Ice and Fire, "${a.title}":\n${a.extract}`);
          sources.set(a.url, { title: a.title, url: a.url });
        }
      } catch {
        found.push('A Wiki of Ice and Fire could not be reached; say so if it matters.');
      }
    }
  }
}

/** The Maester's words after reading a save. They need no AI. A ruler he knows picks up where they left off, a new one gets the full greeting. */
export function readingGreeting(who: { address: string; nickname?: string; house?: string; realm?: string; date: string; known: boolean }): string {
  if (who.known) return `Ah, so this is where we left off, ${who.address}: ${who.date}. What news do you bring?`;
  const name = [who.address, who.nickname].filter(Boolean).join(' ');
  const realm = who.realm && (/^(the|die|der|das)\s/i.test(who.realm) ? who.realm : `the ${who.realm}`);
  return `Hail, ${name}${who.house ? ` of House ${who.house}` : ''}. ${realm ? `The records of ${realm} lie` : 'Your records lie'} open before me, as they stood on ${who.date}. How may I serve you?`;
}

/** A new conversation, before any save was read. The greeting is fixed and costs no AI call. */
export function newChat(id: string): MaesterChat {
  const at = new Date().toISOString();
  return {
    id,
    title: 'New conversation',
    file: '',
    notes: '',
    createdAt: at,
    updatedAt: at,
    messages: [{ role: 'maester', at, text: 'Greetings, my liege. I am your Maester, and my counsel and my books are at your service. How may I be of use?' }],
  };
}

/** Once a conversation is long, older messages move into a summary, because every message resends the conversation. */
export async function compactChat(provider: LlmProvider, chat: MaesterChat): Promise<MaesterChat> {
  const from = chat.summarized ?? 0;
  const open = chat.messages.slice(from);
  if (open.length <= KEEP_MESSAGES || open.reduce((n, m) => n + m.text.length, 0) < KEEP_CHARS) return chat;
  const until = chat.messages.length - KEEP_MESSAGES;
  const old = conversation({ ...chat, messages: chat.messages.slice(0, until) });
  const r = (await provider.generateJson({
    label: 'maester summary',
    system: 'You keep the notes of a Maester in a Crusader Kings III campaign.',
    schema: SUMMARY_SCHEMA,
    effort: 'low',
    prompt: `${chat.summary ? `Earlier summary:\n${chat.summary}\n\n` : ''}Conversation:\n${old}\n\nSummarise in a few short paragraphs what the lord told you (plans, reasons, wishes, events), what you advised and what was decided. Keep names and dates.`,
  })) as { summary: string };
  return { ...chat, summary: r.summary, summarized: until };
}

/** What changed between two digests, line by line. The first line (the date) and section titles do not count. */
export function digestChanges(before: string, after: string, limit = 40): string[] {
  const lines = (text: string) => text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const [a, b] = [new Set(lines(before)), new Set(lines(after))];
  const gone = [...a].filter((l) => !b.has(l)).map((l) => `No longer: ${l.replace(/^- /, '')}`);
  const fresh = [...b].filter((l) => !a.has(l)).map((l) => `New: ${l.replace(/^- /, '')}`);
  return [...fresh, ...gone].slice(0, limit);
}
