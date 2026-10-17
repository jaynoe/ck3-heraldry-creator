// Dev CLI. Usage: npm run cli -- <command> [args] [--playset "Name"]
//   playsets                 list launcher playsets and their mods
//   scan                     catalog summary for a playset (per mod)
//   house <name>             find dynasties by name, show culture, words and CoA key
//   render <coaKey> [--out file.png] [--size 256] [--shading]
//   export <coaKey>          print the CoA as script
//   generate "<idea>" [--parent dynn_Tully] [--variants 3] [--out-dir dir]
//                            AI: names, words and arms via the local Claude Code CLI
//   refine <file.txt> "<instruction>" [--out-dir dir]
//                            AI: revise a pasted CoA script according to the instruction

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { generateHouse } from '../src/core/ai/generate.ts';
import { refineDesign } from '../src/core/ai/refine.ts';
import { parseCoaFile } from '../src/core/coa/parse.ts';
import { serializeCoa } from '../src/core/coa/serialize.ts';
import { renderCoa } from '../src/core/render/render.ts';
import { encodePng } from '../src/node/png.ts';
import { loadPlaysets, openSession, pickPlayset } from '../src/node/paths.ts';
import { ClaudeCliProvider } from '../src/node/providers/claude-cli.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    playset: { type: 'string' },
    out: { type: 'string' },
    size: { type: 'string', default: '256' },
    shading: { type: 'boolean', default: false },
    parent: { type: 'string' },
    variants: { type: 'string', default: '3' },
    'out-dir': { type: 'string', default: 'out' },
    model: { type: 'string' },
    'no-vision': { type: 'boolean', default: false },
  },
});
const [cmd, arg, arg2] = positionals;

const playsets = await loadPlaysets();

if (cmd === 'playsets') {
  for (const p of playsets) {
    console.log(`${p.isActive ? '*' : ' '} ${p.name} (${p.mods.length} mods)`);
  }
  process.exit(0);
}

const playset = pickPlayset(playsets, values.playset);
console.error(`Playset: ${playset.name}`);
const session = await openSession(playset);
const { catalog } = session;

switch (cmd) {
  case 'scan': {
    const perMod = new Map<string, Record<string, number>>();
    for (const [kind, map] of Object.entries(catalog.assets)) {
      for (const a of map.values()) {
        const counts = perMod.get(a.file.layer.name) ?? {};
        counts[kind] = (counts[kind] ?? 0) + 1;
        perMod.set(a.file.layer.name, counts);
      }
    }
    console.table(Object.fromEntries(perMod));
    console.log({
      namedColors: catalog.namedColors.size,
      designerColors: catalog.designerColors.length,
      coas: catalog.coas.size,
      dynasties: catalog.dynasties.size,
      withMottos: [...catalog.dynasties.values()].filter((d) => d.mottos.length).length,
      localizationKeys: catalog.localization.size,
    });
    break;
  }
  case 'house': {
    const q = (arg ?? '').toLowerCase();
    for (const d of catalog.dynasties.values()) {
      if (!d.name.toLowerCase().includes(q)) continue;
      console.log(`${d.key}: ${d.name} [${d.group}, ${d.culture ?? '?'}] ${d.mottos.map((m) => `"${m}"`).join(' / ')}${catalog.coas.has(d.key) ? '' : ' (no CoA)'}`);
    }
    break;
  }
  case 'render': {
    const def = catalog.coas.get(arg ?? '');
    if (!def) throw new Error(`Unknown CoA ${arg}`);
    const ctx = await session.renderContext({ shading: values.shading });
    const { image, warnings } = await renderCoa(def.coa, ctx, Number(values.size));
    const out = values.out ?? `${arg}.png`;
    await writeFile(out, encodePng(image));
    console.log(`Wrote ${out}`);
    for (const w of warnings) console.warn(`warning: ${w}`);
    break;
  }
  case 'export': {
    const def = catalog.coas.get(arg ?? '');
    if (!def) throw new Error(`Unknown CoA ${arg}`);
    process.stdout.write(serializeCoa(def.coa, arg));
    break;
  }
  case 'generate': {
    if (!arg) throw new Error('Usage: generate "<idea>"');
    const started = Date.now();
    const ctx = await session.renderContext();
    const result = await generateHouse(new ClaudeCliProvider({ model: values.model }), catalog, {
      idea: arg,
      parent: values.parent,
      variants: Number(values.variants),
      vision: values['no-vision'] ? undefined : { ctx, encodePng },
      onProgress: (m) => console.error(`… ${m}`),
    });
    const dir = values['out-dir'];
    await mkdir(dir, { recursive: true });
    console.log(`\nRegion: ${result.region}\n\nNames:`);
    for (const n of result.names) console.log(`  ${n.name}${n.existing ? ` (EXISTS in AGOT: ${n.existing})` : ''} — ${n.meaning}`);
    console.log('\nWords:');
    for (const w of result.words) console.log(`  "${w}"`);
    for (const [i, d] of result.designs.entries()) {
      const base = join(dir, `design-${i + 1}`);
      const { image, warnings } = await renderCoa(d.coa, ctx, Number(values.size));
      await writeFile(`${base}.png`, encodePng(image));
      await writeFile(`${base}.txt`, serializeCoa(d.coa, `coa_generated_${i + 1}`));
      console.log(`\nDesign ${i + 1}: ${d.title}\n  ${d.blazon}${d.review ? `\n  review: ${d.review}` : ''}\n  → ${base}.png / .txt`);
      for (const e of [...d.errors, ...warnings]) console.warn(`  warning: ${e}`);
    }
    console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    break;
  }
  case 'refine': {
    const coa = [...parseCoaFile(await readFile(arg ?? '', 'utf8')).values()][0];
    if (!coa || !arg2) throw new Error('Usage: refine <file.txt> "<instruction>"');
    const ctx = await session.renderContext();
    const started = Date.now();
    const r = await refineDesign(new ClaudeCliProvider({ model: values.model }), catalog, {
      coa,
      instruction: arg2,
      vision: values['no-vision'] ? undefined : { ctx, encodePng },
      onProgress: (m) => console.error(`… ${m}`),
    });
    const dir = values['out-dir'];
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'before.png'), encodePng((await renderCoa(coa, ctx, Number(values.size))).image));
    await writeFile(join(dir, 'after.png'), encodePng((await renderCoa(r.coa, ctx, Number(values.size))).image));
    await writeFile(join(dir, 'after.txt'), serializeCoa(r.coa, 'coa_refined'));
    console.log(`\n${r.note}\n→ ${dir}/before.png, after.png, after.txt (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    for (const e of r.errors) console.warn(`warning: ${e}`);
    break;
  }
  default:
    console.error('Commands: playsets, scan, house <name>, render <coaKey>, export <coaKey>, generate "<idea>"');
    process.exit(1);
}
