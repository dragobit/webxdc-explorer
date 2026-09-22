import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { extractWebxdcIcon, getWebxdcPreviewImage } from '@/lib/webxdcIcon';

beforeAll(async () => {
  // jsdom may not expose DecompressionStream — polyfill from node's web streams
  if (!globalThis.DecompressionStream) {
    const { DecompressionStream } = await import('node:stream/web');
    Object.assign(globalThis, { DecompressionStream });
  }
});

interface ZipEntry {
  name: string;
  data: Uint8Array;
  method: 0 | 8;
}

function u16(v: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return b;
}
function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Minimal ZIP builder (CRC left as 0 — the extractor does not verify it). */
function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const stored = e.method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data;

    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(e.method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(e.data.length), u16(name.length), u16(0),
      name, stored,
    ]);

    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(e.method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(e.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
      name,
    ]);

    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const cd = concat(centralParts);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(cd.length), u32(offset), u16(0),
  ]);

  return concat([...localParts, cd, eocd]);
}

function stubFetchZip(zip: Uint8Array) {
  const body = zip.slice().buffer as ArrayBuffer;
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    headers: { get: (k: string) => (k === 'content-length' ? String(body.byteLength) : null) },
    arrayBuffer: async () => body,
  })));
}

function eventWithTags(tags: string[][]): NostrEvent {
  return {
    id: 'e1',
    pubkey: 'p',
    created_at: 1,
    kind: 1063,
    tags,
    content: '',
    sig: '',
  };
}

describe('extractWebxdcIcon', () => {
  it('returns a png blob for a stored icon.png', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    stubFetchZip(buildZip([
      { name: 'index.html', data: new Uint8Array([1, 2, 3]), method: 0 },
      { name: 'icon.png', data: png, method: 0 },
    ]));
    const blob = await extractWebxdcIcon('https://x.test/app.xdc');
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(png.length);
  });

  it('returns a png blob for a deflated icon.png', async () => {
    const png = new Uint8Array(Array.from({ length: 200 }, (_, i) => i % 256));
    stubFetchZip(buildZip([
      { name: 'index.html', data: new Uint8Array([1, 2, 3]), method: 8 },
      { name: 'icon.png', data: png, method: 8 },
    ]));
    const blob = await extractWebxdcIcon('https://x.test/app.xdc');
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(png.length);
  });

  it('returns undefined when no icon exists', async () => {
    stubFetchZip(buildZip([
      { name: 'index.html', data: new Uint8Array([1, 2, 3]), method: 0 },
    ]));
    expect(await extractWebxdcIcon('https://x.test/app.xdc')).toBeUndefined();
  });
});

describe('getWebxdcPreviewImage', () => {
  it('returns the webxdc imeta image field', () => {
    const e = eventWithTags([
      ['imeta', 'url https://x.test/app.xdc', 'm application/x-webxdc', 'image https://x.test/p.png'],
    ]);
    expect(getWebxdcPreviewImage(e)).toBe('https://x.test/p.png');
  });

  it('falls back to a separate image imeta url', () => {
    const e = eventWithTags([
      ['imeta', 'url https://x.test/app.xdc', 'm application/x-webxdc'],
      ['imeta', 'url https://x.test/pic.jpg', 'm image/jpeg'],
    ]);
    expect(getWebxdcPreviewImage(e)).toBe('https://x.test/pic.jpg');
  });

  it('rejects non-https urls', () => {
    const e = eventWithTags([
      ['imeta', 'url https://x.test/app.xdc', 'm application/x-webxdc', 'image http://x.test/p.png'],
      ['imeta', 'url javascript:alert(1)', 'm image/png'],
    ]);
    expect(getWebxdcPreviewImage(e)).toBeUndefined();
  });
});
