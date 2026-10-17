// Integration tests against the real CK3 + AGOT install. Skipped when the files are not present
// (e.g. in CI), because game and mod assets are never committed.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bookmarkYear } from '../src/core/catalog/catalog.ts';
import { frameFor } from '../src/core/render/frame.ts';
import { renderCoa } from '../src/core/render/render.ts';
import { createLayers, HeraldrySession } from '../src/core/session.ts';
import { NodeFileSource } from '../src/node/node-fs.ts';
import { defaultPaths } from '../src/node/paths.ts';

const paths = defaultPaths();
const agot = join(paths.workshop, '2962333032');
const available = existsSync(paths.game) && existsSync(agot);

describe.skipIf(!available)('local CK3 + AGOT install', async () => {
  const session = available
    ? await HeraldrySession.open(
        await createLayers(new NodeFileSource(paths.game), [
          { id: 'agot', name: 'A Game of Thrones', source: new NodeFileSource(agot) },
        ]),
      )
    : undefined!;

  it('loads AGOT houses with words', () => {
    const stark = session.catalog.dynasties.get('dynn_Stark');
    expect(stark).toMatchObject({ name: 'Stark', culture: 'northman', group: 'north' });
    expect(stark?.mottos).toContain('Winter is Coming');
  });

  it('includes the houses of a dynasty, such as Karstark under Stark', () => {
    const karstark = session.catalog.dynasties.get('house_Karstark');
    expect(karstark).toMatchObject({ name: 'Karstark', dynasty: 'dynn_Stark', group: 'north' });
    expect(session.catalog.coas.has('house_Karstark')).toBe(true);
  });

  it('reads AGOT bookmarks and mod game rules with their names', () => {
    const ninepenny = session.catalog.bookmarks.find((b) => b.key === 'agot_bm_8259');
    expect(ninepenny).toMatchObject({ name: 'The Ninepenny Kings', startDate: '8258.12.21' });
    expect(ninepenny!.description).not.toMatch(/#bold|#!/);
    expect(bookmarkYear(ninepenny!.startDate)).toBe('258 AC');
    const shattered = session.catalog.gameRules.find((r) => r.key === 'agot_shattered_world');
    expect(shattered?.name).toContain('Shattered World');
    expect(shattered?.options.map((o) => o.name)).toContain('Counties');
    expect(session.catalog.gameRules.some((r) => r.key === 'gender_equality')).toBe(false); // vanilla rules are left out
  });

  it('knows the shield shape of each culture and loads its mask', async () => {
    expect(frameFor(session.catalog, { house: 'dynn_Stark' })).toBe('house_frame_andal1');
    const mask = await session.frameMask('house_frame_andal1');
    expect(mask?.width).toBe(160);
    expect(mask!.data[3]).toBe(0); // the corner lies outside the shield
  });

  it('lets AGOT override vanilla files', () => {
    expect(session.catalog.assets.colored_emblem.get('no_stark_wolf.dds')?.file.layer.id).toBe('agot');
    expect(session.catalog.namedColors.has('agot_red')).toBe(true);
  });

  it('renders the Stark CoA without warnings', async () => {
    const ctx = await session.renderContext();
    const { image, warnings } = await renderCoa(session.catalog.coas.get('dynn_Stark')!.coa, ctx, 64);
    expect(warnings).toEqual([]);
    expect(image.width).toBe(64);
  });
});
