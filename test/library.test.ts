import { describe, expect, it } from 'vitest';
import { jsonLibrary, type SavedCoa } from '../src/core/library.ts';

const coa = (id: string): SavedCoa => ({ id, name: id, script: '', createdAt: '' });

describe('jsonLibrary', () => {
  it('keeps both entries when two saves run at the same time', async () => {
    let file = '[]';
    // A slow host: reads and writes take a moment, as over IPC or HTTP.
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const lib = jsonLibrary(
      async () => (await tick(), file),
      async (json) => {
        await tick();
        file = json;
      },
    );
    await Promise.all([lib.save(coa('a')), lib.save(coa('b'))]);
    expect((await lib.list()).map((i) => i.id).sort()).toEqual(['a', 'b']);
    await lib.remove('a');
    expect((await lib.list()).map((i) => i.id)).toEqual(['b']);
  });

  it('does not write when the file cannot be read', async () => {
    let writes = 0;
    const lib = jsonLibrary(
      async () => 'not json',
      async () => void writes++,
    );
    await expect(lib.save(coa('a'))).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
