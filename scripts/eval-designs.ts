// Design eval: runs a fixed set of ideas through generation and writes an HTML report with every design,
// shown like in the app (shield shape and frame), next to "gold" arms from the Collection. Compare reports
// before and after a prompt change. Each idea costs a full generation on the local Claude Code CLI.
//
// Usage: npm run eval-designs -- [--ideas scripts/eval/ideas.txt] [--gold "Rosewater,Cleganstark"]
//          [--mode economy|normal|thorough] [--variants 3] [--only 2] [--no-generate] [--out out/eval-…]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { generateHouse, type GenerationResult } from '../src/core/ai/generate.ts';
import { mentionedHouses } from '../src/core/ai/examples.ts';
import { AI_MODES, withRequestOptions, type AiMode } from '../src/core/ai/mode.ts';
import { withShapeCheck } from '../src/core/ai/provider.ts';
import type { CoatOfArms } from '../src/core/coa/model.ts';
import { parseCoaFile } from '../src/core/coa/parse.ts';
import { applyFrame, applyMask, frameFor, frameOpening, placeOn } from '../src/core/render/frame.ts';
import { renderCoa } from '../src/core/render/render.ts';
import type { HeraldrySession } from '../src/core/session.ts';
import type { LibraryItem } from '../src/core/library.ts';
import { encodePng } from '../src/node/png.ts';
import { loadPlaysets, openSession, pickPlayset } from '../src/node/paths.ts';
import { ClaudeCliProvider } from '../src/node/providers/claude-cli.ts';

const { values } = parseArgs({
  options: {
    ideas: { type: 'string', default: 'scripts/eval/ideas.txt' },
    gold: { type: 'string', default: '' },
    mode: { type: 'string', default: 'normal' },
    variants: { type: 'string', default: '3' },
    only: { type: 'string' },
    out: { type: 'string', default: `out/eval-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}` },
    playset: { type: 'string' },
    model: { type: 'string' },
    'no-generate': { type: 'boolean', default: false },
  },
});

const SIZE = 192;
const mode = AI_MODES[values.mode as AiMode];
if (!mode) throw new Error(`--mode must be one of ${Object.keys(AI_MODES).join(', ')}`);

const session = await openSession(pickPlayset(await loadPlaysets(), values.playset));
const { catalog } = session;
const ctx = await session.renderContext();
await mkdir(values.out, { recursive: true });

/** Renders like the app's preview: arms scaled into the frame's opening, cut to the shield, frame on top. */
async function framed(s: HeraldrySession, coa: CoatOfArms, frame: string | undefined): Promise<Uint8Array> {
  const mask = frame ? await s.frameMask(frame) : undefined;
  const art = frame ? await s.frameArt(frame) : undefined;
  if (mask && art) {
    const o = frameOpening(mask, art);
    const inner = (await renderCoa(coa, ctx, Math.max(1, Math.round(o.size * SIZE)))).image;
    return encodePng(applyFrame(applyMask(placeOn(inner, SIZE, Math.round(o.x * SIZE), Math.round(o.y * SIZE)), mask), art));
  }
  const img = (await renderCoa(coa, ctx, SIZE)).image;
  return encodePng(mask ? applyMask(img, mask) : img);
}

let n = 0;
async function image(coa: CoatOfArms, frame: string | undefined): Promise<string> {
  const file = `img-${++n}.png`;
  await writeFile(join(values.out, file), await framed(session, coa, frame));
  return file;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sections: string[] = [];

// Gold standard: arms from the Collection that show what "good" means.
const goldNames = values.gold.split(',').map((g) => g.trim()).filter(Boolean);
if (goldNames.length) {
  const library = JSON.parse(await readFile(join(homedir(), '.local/share/ck3-heraldry-creator/library.json'), 'utf8')) as LibraryItem[];
  const cards: string[] = [];
  for (const name of goldNames) {
    const item = library.find((i) => i.kind !== 'idea' && i.name.toLowerCase() === name.toLowerCase());
    if (!item || item.kind === 'idea') {
      console.warn(`gold: "${name}" is not in the Collection`);
      continue;
    }
    const coa = [...parseCoaFile(item.script).values()][0];
    if (!coa) continue;
    const img = await image(coa, frameFor(catalog, { parent: item.parent, region: item.region }));
    cards.push(`<figure><img src="${img}"><figcaption><b>${esc(item.name)}</b>${item.idea ? `<small>${esc(item.idea)}</small>` : ''}</figcaption></figure>`);
  }
  sections.push(`<section><h2>Gold standard</h2><div class="row">${cards.join('')}</div></section>`);
}

const lines = (await readFile(values.ideas, 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const ideas = lines.slice(0, values.only ? Number(values.only) : undefined).map((l) => {
  const [idea, ...opts] = l.split('|').map((p) => p.trim());
  const parent = opts.find((o) => o.startsWith('parent='))?.slice(7);
  return { idea: idea!, parent };
});

const provider = withRequestOptions(withShapeCheck(new ClaudeCliProvider({ model: values.model })), { effort: mode.effort });
const started = Date.now();
for (const [i, { idea, parent }] of ideas.entries()) {
  const houses = mentionedHouses(catalog, idea).filter((h) => h.dynasty.key !== parent);
  const named = await Promise.all(
    houses.map(async (h) => `<figure class="small"><img src="${await image(h.coa, frameFor(catalog, { house: h.dynasty.key }))}"><figcaption>${esc(h.dynasty.name)}</figcaption></figure>`),
  );
  let body = '';
  if (!values['no-generate']) {
    console.error(`[${i + 1}/${ideas.length}] ${idea.slice(0, 70)}…`);
    let result: GenerationResult | undefined;
    let error = '';
    try {
      result = await generateHouse(provider, catalog, {
        idea,
        parent,
        variants: Number(values.variants),
        vision: mode.vision ? { ctx, encodePng } : undefined,
        repairRounds: mode.repairRounds,
        onProgress: (m) => console.error(`  … ${m}`),
      });
    } catch (e) {
      error = (e as Error).message;
      console.error(`  failed: ${error}`);
    }
    if (result) {
      const frame = frameFor(catalog, { parent, region: result.region });
      const designs = await Promise.all(
        result.designs.map(
          async (d) =>
            `<figure><img src="${await image(d.coa, frame)}"><figcaption><b>${esc(d.title)}</b><small>${esc(d.blazon)}</small>${
              d.errors.length ? `<small class="err">${esc(d.errors.join('; '))}</small>` : ''
            }</figcaption></figure>`,
        ),
      );
      body = `<p class="meta">${esc(result.region)} · ${result.names.map((x) => esc(x.name)).join(', ')} · “${esc(result.words[0] ?? '')}”</p><div class="row">${designs.join('')}</div>`;
      await writeFile(join(values.out, `idea-${i + 1}.json`), JSON.stringify({ idea, parent, result: { ...result, designs: result.designs.map(({ coa: _c, ...d }) => d) } }, null, 2));
    } else body = `<p class="err">${esc(error)}</p>`;
  }
  sections.push(
    `<section><h2>${i + 1}. ${esc(idea)}${parent ? ` <small>(cadet of ${esc(parent)})</small>` : ''}</h2>${
      named.length ? `<div class="row named"><span>Named houses:</span>${named.join('')}</div>` : ''
    }${body}</section>`,
  );
}

const html = `<!doctype html><meta charset="utf-8"><title>Design eval ${esc(values.out)}</title>
<style>
body{background:#0b0a09;color:#efe8d8;font:14px/1.45 system-ui,sans-serif;margin:24px;max-width:1400px}
h1{font-weight:400}h2{font-size:16px;font-weight:600;margin:28px 0 8px}h2 small{color:#a99f8c;font-weight:400}
.meta{color:#a99f8c;margin:0 0 10px}.row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0;width:${SIZE + 24}px;background:#16140f;border:1px solid #3a342c;padding:12px}
figure img{display:block;width:${SIZE}px;height:${SIZE}px;image-rendering:auto}
figcaption{display:grid;gap:4px;margin-top:8px}small{color:#a99f8c}.err{color:#e39a8f}
.named{align-items:center;margin-bottom:10px}.named span{color:#a99f8c}figure.small{width:96px;padding:6px}figure.small img{width:84px;height:84px}
</style>
<h1>Design eval</h1>
<p class="meta">${esc(new Date().toLocaleString())} · mode ${esc(values.mode)} · ${ideas.length} ideas${values['no-generate'] ? ' · no generation' : ` · ${((Date.now() - started) / 60000).toFixed(1)} min`}</p>
${sections.join('\n')}`;
await writeFile(join(values.out, 'index.html'), html);
console.log(`Report: ${join(values.out, 'index.html')}`);
