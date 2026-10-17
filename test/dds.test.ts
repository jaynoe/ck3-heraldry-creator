import { describe, expect, it } from 'vitest';
import { decodeDds } from '../src/core/dds/dds.ts';

function header(width: number, height: number, pf: { flags: number; fourCC?: string; bits?: number; masks?: number[] }) {
  const h = new DataView(new ArrayBuffer(128));
  h.setUint32(0, 0x20534444, true);
  h.setUint32(4, 124, true);
  h.setUint32(12, height, true);
  h.setUint32(16, width, true);
  h.setUint32(76, 32, true);
  h.setUint32(80, pf.flags, true);
  if (pf.fourCC) for (let i = 0; i < 4; i++) h.setUint8(84 + i, pf.fourCC.charCodeAt(i));
  if (pf.bits) h.setUint32(88, pf.bits, true);
  pf.masks?.forEach((m, i) => h.setUint32(92 + i * 4, m, true));
  return new Uint8Array(h.buffer);
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
};

describe('decodeDds', () => {
  it('decodes uncompressed BGRA via channel masks', () => {
    const bytes = concat(
      header(1, 1, { flags: 0x41, bits: 32, masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000] }),
      new Uint8Array([30, 20, 10, 200]), // B G R A
    );
    expect([...decodeDds(bytes).data]).toEqual([10, 20, 30, 200]);
  });

  it('decodes a solid DXT1 block', () => {
    // c0 = c1 = pure red (565: 0xF800), all indices 0
    const block = new Uint8Array([0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0]);
    const img = decodeDds(concat(header(4, 4, { flags: 0x4, fourCC: 'DXT1' }), block));
    expect([...img.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...img.data.subarray(60, 64)]).toEqual([255, 0, 0, 255]);
  });

  it('rejects non-DDS data', () => {
    expect(() => decodeDds(new Uint8Array(200))).toThrow('Not a DDS file');
  });
});
