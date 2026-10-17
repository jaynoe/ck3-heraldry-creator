// Render CoA definitions from a script file (e.g. a paste from the in-game designer).
// Usage: npm run render-file -- <file.txt> [--out-dir dir] [--playset "Name"] [--size 256]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCoaFile } from '../src/core/coa/parse.ts';
import { renderCoa } from '../src/core/render/render.ts';
import { encodePng } from '../src/node/png.ts';
import { loadPlaysets, openSession, pickPlayset } from '../src/node/paths.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { playset: { type: 'string' }, 'out-dir': { type: 'string', default: '.' }, size: { type: 'string', default: '256' } },
});
const session = await openSession(pickPlayset(await loadPlaysets(), values.playset));
const ctx = await session.renderContext();
for (const [key, coa] of parseCoaFile(await readFile(positionals[0]!, 'utf8'))) {
  const { image, warnings } = await renderCoa(coa, ctx, Number(values.size));
  const out = join(values['out-dir'], `${key || 'coa'}.png`);
  await writeFile(out, encodePng(image));
  console.log(`Wrote ${out}`);
  for (const w of warnings) console.warn(`warning: ${w}`);
}
