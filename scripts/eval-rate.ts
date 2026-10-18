// Blind rating page for design eval runs: every idea's designs from all runs, shuffled and unlabelled,
// rated with 1–5 stars. "Reveal" shows the average per run and the best and worst designs. Ratings stay in
// the browser and can be saved as JSON (ratings-….json in the downloads folder) for the next prompt round.
//
// Usage: npm run eval-rate -- out/eval-old out/eval-new [--out out/rate.html]

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', default: 'out/rate.html' } } });
if (positionals.length < 1) throw new Error('Usage: eval-rate <run dir> [<run dir> …]');

interface Design {
  id: string;
  run: string;
  idea: number;
  title: string;
  blazon: string;
  img: string;
}

const unescape = (t: string) => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ideas = new Map<number, string>();
const designs: Design[] = [];
for (const dir of positionals) {
  const run = basename(dir);
  const html = await readFile(`${dir}/index.html`, 'utf8');
  for (const [, n, title, body] of html.matchAll(/<section><h2>(\d+)\. (.*?)<\/h2>(.*?)<\/section>/gs)) {
    ideas.set(Number(n), unescape(title!.replace(/<[^>]+>/g, '')));
    let i = 0;
    for (const [, img, t, b] of body!.matchAll(/<figure><img src="([^"]+)"><figcaption><b>(.*?)<\/b><small>(.*?)<\/small>/gs)) {
      designs.push({ id: `${run}:${n}:${++i}`, run, idea: Number(n), title: unescape(t!), blazon: unescape(b!), img: img! });
    }
  }
}
if (designs.some((d) => !d.img.startsWith('data:'))) console.warn('Some images are files, not embedded; the page needs them next to it.');

const data = { runs: positionals.map((d) => basename(d)), ideas: Object.fromEntries(ideas), designs };
const page = `<!doctype html><meta charset="utf-8"><title>Rate designs</title>
<style>
body{background:#0b0a09;color:#efe8d8;font:14px/1.45 system-ui,sans-serif;margin:24px;max-width:1300px}
h1{font-weight:400;margin:0 0 4px}h2{font-size:15px;margin:30px 0 10px}.muted{color:#a99f8c}
.grid{display:flex;flex-wrap:wrap;gap:12px}.card{width:200px;background:#16140f;border:2px solid #3a342c;padding:10px}
.card[data-r="5"],.card[data-r="4"]{border-color:#c9a24e}.card[data-r="1"]{border-color:#e39a8f}
.card img{width:180px;height:180px;display:block}.title{font-weight:600;margin:8px 0 2px}.blazon{color:#a99f8c;font-size:12px}
.stars{display:flex;gap:2px;margin-top:8px}.stars button{background:none;border:0;color:#5a5246;font-size:24px;cursor:pointer;padding:0 2px;line-height:1}
.stars button.on{color:#c9a24e}textarea{width:100%;box-sizing:border-box;margin-top:6px;background:#0b0a09;color:#efe8d8;border:1px solid #3a342c;font:12px system-ui;resize:vertical;min-height:30px}
.bar{position:sticky;top:0;background:#0b0a09;padding:10px 0;border-bottom:2px solid #3a342c;display:flex;gap:12px;align-items:center;z-index:1}
.bar button{background:transparent;color:#efe8d8;border:2px solid #3a342c;padding:6px 14px;font-weight:600;cursor:pointer;text-transform:uppercase;font-size:12px;letter-spacing:.08em}
.bar button:hover{border-color:#efe8d8}.status{color:#c9a24e}.run{display:none;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#c9a24e;margin-top:4px}
body.revealed .run{display:block}#reveal{display:none;margin-top:30px;border-top:2px solid #3a342c}body.revealed #reveal{display:block}
table{border-collapse:collapse}td,th{padding:4px 14px 4px 0;text-align:left}
</style>
<h1>Rate designs</h1>
<p class="muted">Blind: each idea shows the designs of all runs, shuffled and without labels. 5 stars = great, 1 = bad. Notes are optional. Your ratings stay in this browser.</p>
<div class="bar"><span class="status" id="count"></span><button id="save">Save ratings</button><button id="show">Reveal results</button><span class="status" id="msg"></span></div>
<div id="list"></div>
<div id="reveal"></div>
<script>
const DATA = ${JSON.stringify(data)};
const KEY = 'heraldry-rate:' + DATA.runs.join('+');
let ratings = {};
try { ratings = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(ratings)); } catch {} count(); };
// A fixed shuffle per page, so the order stays the same on reload.
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); h ^= h >>> 15; return Math.imul(h, 2246822507) >>> 0; };
const list = document.getElementById('list');
for (const [n, idea] of Object.entries(DATA.ideas)) {
  const h = document.createElement('h2'); h.textContent = n + '. ' + idea; list.append(h);
  const grid = document.createElement('div'); grid.className = 'grid'; list.append(grid);
  for (const d of DATA.designs.filter((d) => String(d.idea) === n).sort((a, b) => hash(a.id) - hash(b.id))) {
    const r = ratings[d.id] || {};
    const card = document.createElement('div'); card.className = 'card'; card.dataset.r = r.stars || '';
    card.innerHTML = '<img alt=""><div class="title"></div><div class="blazon"></div><div class="run"></div><div class="stars"></div><textarea placeholder="Note (optional)"></textarea>';
    card.querySelector('img').src = d.img;
    card.querySelector('.title').textContent = d.title;
    card.querySelector('.blazon').textContent = d.blazon;
    card.querySelector('.run').textContent = d.run;
    const stars = card.querySelector('.stars');
    const paint = () => [...stars.children].forEach((b, i) => b.classList.toggle('on', i < (ratings[d.id]?.stars || 0)));
    for (let s = 1; s <= 5; s++) {
      const b = document.createElement('button'); b.textContent = '★'; b.title = s + ' of 5';
      b.onclick = () => { ratings[d.id] = { ...ratings[d.id], stars: ratings[d.id]?.stars === s ? 0 : s }; card.dataset.r = ratings[d.id].stars || ''; paint(); persist(); };
      stars.append(b);
    }
    paint();
    const note = card.querySelector('textarea'); note.value = r.note || '';
    note.oninput = () => { ratings[d.id] = { ...ratings[d.id], note: note.value }; persist(); };
    grid.append(card);
  }
}
function count() {
  const done = DATA.designs.filter((d) => ratings[d.id]?.stars).length;
  document.getElementById('count').textContent = done + ' / ' + DATA.designs.length + ' rated';
}
count();
document.getElementById('save').onclick = () => {
  const out = DATA.designs.map((d) => ({ id: d.id, run: d.run, idea: d.idea, title: d.title, stars: ratings[d.id]?.stars || null, note: ratings[d.id]?.note || '' }));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = 'ratings-' + DATA.runs.join('+') + '.json';
  a.click();
  document.getElementById('msg').textContent = '✓ Saved to your downloads folder';
};
document.getElementById('show').onclick = () => {
  document.body.classList.toggle('revealed');
  const rated = DATA.designs.filter((d) => ratings[d.id]?.stars).map((d) => ({ ...d, stars: ratings[d.id].stars }));
  const rows = DATA.runs.map((run) => {
    const s = rated.filter((d) => d.run === run).map((d) => d.stars);
    const avg = s.length ? (s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) : '–';
    return '<tr><td>' + run + '</td><td>' + avg + ' ★</td><td>' + s.length + ' rated</td><td>' + s.filter((x) => x >= 4).length + ' good (4–5)</td><td>' + s.filter((x) => x <= 2).length + ' bad (1–2)</td></tr>';
  }).join('');
  const line = (d) => '<li>' + '★'.repeat(d.stars) + ' — ' + d.title.replace(/</g, '&lt;') + ' <span class="muted">(idea ' + d.idea + ', ' + d.run + ')</span></li>';
  const sorted = [...rated].sort((a, b) => b.stars - a.stars);
  document.getElementById('reveal').innerHTML = '<h2>Results</h2><table><tr><th>Run</th><th>Average</th><th></th><th></th><th></th></tr>' + rows + '</table>' +
    '<h2>Top 5</h2><ol>' + sorted.slice(0, 5).map(line).join('') + '</ol><h2>Flop 5</h2><ol>' + sorted.slice(-5).reverse().map(line).join('') + '</ol>';
  document.getElementById('show').textContent = document.body.classList.contains('revealed') ? 'Hide results' : 'Reveal results';
};
</script>`;
await writeFile(values.out, page);
console.log(`Rating page: ${values.out} (${designs.length} designs from ${positionals.length} runs)`);
