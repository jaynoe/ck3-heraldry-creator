// Canon facts from A Wiki of Ice and Fire (awoiaf.westeros.org), the primary source for lore.
// Requests go through the host (dev server or Tauri), which sends them to the wiki's MediaWiki API
// with an identifying User-Agent: the site's crawler guard blocks headless and anonymous clients,
// and browsers may not set that header themselves. Requests are batched to stay polite.

export interface WikiArticle {
  title: string;
  url: string;
  /** Plain-text introduction of the article. */
  extract: string;
}

/** Looks up articles by title; titles that do not exist are found through the wiki's search. */
export type CanonSource = (titles: string[]) => Promise<WikiArticle[]>;

export const AWOIAF = 'https://awoiaf.westeros.org';
const MAX_TITLES = 16;
const MAX_SEARCHES = 6;
const MAX_EXTRACT = 1200;

/** Runs one MediaWiki API query (`action=query`) with these parameters and returns the parsed JSON. */
export type WikiQuery = (params: Record<string, string>) => Promise<unknown>;

/** The only parameters a host forwards; anything else is refused. */
export const WIKI_PARAMS = ['action', 'prop', 'inprop', 'exintro', 'explaintext', 'exlimit', 'redirects', 'titles', 'list', 'srsearch', 'srlimit', 'formatversion'];
export const WIKI_API = `${AWOIAF}/api.php`;
export const WIKI_USER_AGENT = 'HeraldryCreator/0.1 (CK3 AGOT coat of arms tool; https://github.com/jaynoe/ck3-heraldry-creator)';

/** A WikiQuery that calls the API with `fetch` (Node, tests); the host versions mirror it. */
export function fetchWikiQuery(fetchFn: (url: string, init?: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>): WikiQuery {
  return async (params) => {
    if (params.action !== 'query' || Object.keys(params).some((k) => !WIKI_PARAMS.includes(k))) throw new Error('wiki query not allowed');
    const res = await fetchFn(`${WIKI_API}?${new URLSearchParams({ ...params, format: 'json' })}`, { headers: { 'User-Agent': WIKI_USER_AGENT } });
    if (!res.ok) throw new Error(`AWOIAF answered ${res.status}`);
    return res.json();
  };
}

interface QueryResult {
  query?: {
    redirects?: { from: string; to: string }[];
    normalized?: { from: string; to: string }[];
    pages?: Record<string, { title: string; missing?: string; extract?: string; fullurl?: string }>;
    search?: { title: string }[];
  };
}

export function awoiafSource(query: WikiQuery): CanonSource {
  const get = async (params: Record<string, string>) => (await query({ ...params, formatversion: '1' })) as QueryResult;
  const extracts = async (titles: string[]) => {
    if (!titles.length) return { found: [] as WikiArticle[], missing: [] as string[] };
    const r = await get({
      action: 'query',
      prop: 'extracts|info',
      inprop: 'url',
      exintro: '1',
      explaintext: '1',
      exlimit: String(titles.length),
      redirects: '1',
      titles: titles.join('|'),
    });
    const found: WikiArticle[] = [];
    const missing: string[] = [];
    for (const p of Object.values(r.query?.pages ?? {})) {
      if (p.missing !== undefined || !p.extract) missing.push(p.title);
      else found.push({ title: p.title, url: p.fullurl ?? `${AWOIAF}/index.php/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, extract: clip(p.extract) });
    }
    return { found, missing };
  };

  return async (titles) => {
    const wanted = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TITLES);
    // "Warg Kings" is "Warg King" on the wiki; asking for both costs nothing in the same request.
    const singular = wanted.map((t) => t.replace(/([^s])s$/, '$1')).filter((t) => !wanted.includes(t));
    const first = await extracts([...wanted, ...singular]);
    first.missing = first.missing.filter((t) => wanted.includes(t) && !first.found.some((f) => f.title === t.replace(/([^s])s$/, '$1')));
    // A title the model got slightly wrong usually turns up as the first search hit.
    const hits = await Promise.all(
      first.missing.slice(0, MAX_SEARCHES).map(async (t) => (await get({ action: 'query', list: 'search', srsearch: t, srlimit: '1' })).query?.search?.[0]?.title),
    );
    const known = new Set(first.found.map((a) => a.title));
    const second = await extracts([...new Set(hits.filter((h): h is string => !!h && !known.has(h)))]);
    return [...first.found, ...second.found];
  };
}

const clip = (s: string) => {
  const text = s.replace(/\n{2,}/g, '\n').trim();
  if (text.length <= MAX_EXTRACT) return text;
  const cut = text.slice(0, MAX_EXTRACT);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('. '), MAX_EXTRACT * 0.6) + 1).trim()} …`;
};

/** Matches an article to a title the model gave, allowing for redirects and search hits by word overlap. */
export function articlesFor(titles: string[], articles: WikiArticle[]): WikiArticle[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(' ')
      .filter((w) => w.length > 2 && w !== 'house' && w !== 'the')
      .map((w) => w.replace(/([^s])s$/, '$1'));
  return articles.filter((a) => {
    const words = norm(a.title);
    return titles.some((t) => {
      const tw = norm(t);
      return a.title.toLowerCase() === t.toLowerCase() || (words.length > 0 && words.every((w) => tw.includes(w))) || (tw.length > 0 && tw.every((w) => words.includes(w)));
    });
  });
}
