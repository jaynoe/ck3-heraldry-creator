import { describe, expect, it } from 'vitest';
import { articlesFor, awoiafSource, fetchWikiQuery } from '../src/core/ai/canon.ts';

/** Fake MediaWiki API: known pages by title, search maps a query to a title. */
function fakeWiki(pages: Record<string, string>, search: Record<string, string> = {}) {
  const urls: URL[] = [];
  const fetchFn = async (url: string, init?: { headers: Record<string, string> }) => {
    expect(init?.headers['User-Agent']).toContain('HeraldryCreator');
    const u = new URL(url);
    urls.push(u);
    const p = Object.fromEntries(u.searchParams);
    let body: unknown;
    if (p.list === 'search') body = { query: { search: search[p.srsearch!] ? [{ title: search[p.srsearch!] }] : [] } };
    else
      body = {
        query: {
          pages: Object.fromEntries(
            p.titles!.split('|').map((t, i) => [pages[t] ? String(i) : `-${i}`, pages[t] ? { title: t, extract: pages[t], fullurl: `https://awoiaf.westeros.org/index.php/${t.replace(/ /g, '_')}` } : { title: t, missing: '' }]),
          ),
        },
      };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchFn, urls };
}

describe('AWOIAF lookup', () => {
  it('refuses anything but read-only queries with known parameters', async () => {
    const q = fetchWikiQuery(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await expect(q({ action: 'edit', title: 'x' })).rejects.toThrow('not allowed');
    await expect(q({ action: 'query', titles: 'x', callback: 'evil' })).rejects.toThrow('not allowed');
  });

  it('fetches extracts in one batch and finds missing titles through search', async () => {
    const { fetchFn, urls } = fakeWiki(
      { 'Moat Cailin': 'Moat Cailin is an ancient stronghold.', 'Warg King': 'The Warg King ruled the Sea Dragon Point.', Skinchanger: 'A skinchanger enters animals.' },
      { 'Marsh Kings of old': 'Marsh King' },
    );
    const articles = await awoiafSource(fetchWikiQuery(fetchFn))(['Moat Cailin', 'Warg Kings', 'Moat Cailin', 'Marsh Kings of old']);
    expect(articles.map((a) => a.title)).toEqual(['Moat Cailin', 'Warg King']);
    expect(urls.every((u) => u.origin === 'https://awoiaf.westeros.org' && u.pathname === '/api.php' && u.searchParams.get('format') === 'json')).toBe(true);
    // deduplicated and with the singular form in the same request
    expect(urls[0]!.searchParams.get('titles')).toBe('Moat Cailin|Warg Kings|Marsh Kings of old|Warg King');
    expect(urls.map((u) => u.searchParams.get('list') ?? 'extracts')).toEqual(['extracts', 'search', 'extracts']); // only the truly missing title is searched
  });

  it('matches articles to the titles an idea asked for, also through redirects and search hits', () => {
    const a = (title: string) => ({ title, url: '', extract: '' });
    const articles = [a('Moat Cailin'), a('House Karstark'), a('Warg King'), a('Summerhall')];
    expect(articlesFor(['Moat Cailin', 'Karstark', 'Warg Kings'], articles).map((x) => x.title)).toEqual(['Moat Cailin', 'House Karstark', 'Warg King']);
    expect(articlesFor(['The Warg King'], articles).map((x) => x.title)).toEqual(['Warg King']);
  });
});
