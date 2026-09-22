import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { extractWebxdcIcon, getWebxdcPreviewImage, MAX_XDC_BYTES } from '@/lib/webxdcIcon';

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

interface FetchStubOptions {
  /** honor Range headers with 206 + Content-Range (default: ignore Range, return 200) */
  ranges?: boolean;
  /** omit Content-Range on 206 responses (simulates CORS-hidden header) */
  hideContentRange?: boolean;
  /** record the Range header of each request into this array ('full' when absent) */
  record?: string[];
  /** override the body returned for full (non-range) fetches */
  fullBody?: ArrayBuffer;
  /** omit the content-length header */
  noContentLength?: boolean;
}

function stubFetchZip(zip: Uint8Array, opts: FetchStubOptions = {}) {
  const body = (opts.fullBody ?? zip.slice().buffer) as ArrayBuffer;
  const makeHeaders = (extra: Record<string, string> = {}) => ({
    get: (k: string) =>
      extra[k.toLowerCase()] ??
      (k === 'content-length' && !opts.noContentLength ? String(body.byteLength) : null),
  });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { headers?: { Range?: string } }) => {
    const range = init?.headers?.Range;
    opts.record?.push(range ?? 'full');
    if (!range || !opts.ranges) {
      return {
        ok: true,
        status: 200,
        headers: makeHeaders(),
        arrayBuffer: async () => body,
      };
    }
    // Parse `bytes=-N` (suffix) or `bytes=a-b`.
    let start: number;
    let end: number;
    const suffix = range.match(/^bytes=-(\d+)$/);
    const explicit = range.match(/^bytes=(\d+)-(\d+)$/);
    if (suffix) {
      start = Math.max(0, body.byteLength - Number(suffix[1]));
      end = body.byteLength - 1;
    } else if (explicit) {
      start = Number(explicit[1]);
      end = Math.min(Number(explicit[2]), body.byteLength - 1);
    } else {
      throw new Error(`bad range ${range}`);
    }
    const slice = body.slice(start, end + 1);
    const extra: Record<string, string> = {};
    if (!opts.hideContentRange) {
      extra['content-range'] = `bytes ${start}-${end}/${body.byteLength}`;
    }
    return {
      ok: true,
      status: 206,
      headers: makeHeaders(extra),
      arrayBuffer: async () => slice,
    };
  }));
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

  it('uses range requests on capable servers and never fetches the whole file', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    // Several entries so the central directory isn't trivially tiny.
    const record: string[] = [];
    stubFetchZip(buildZip([
      { name: 'index.html', data: new Uint8Array([1, 2, 3]), method: 0 },
      { name: 'manifest.toml', data: new Uint8Array([4, 5]), method: 0 },
      { name: 'icon.png', data: png, method: 8 },
    ]), { ranges: true, record });
    const blob = await extractWebxdcIcon('https://x.test/app.xdc');
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(png.length);
    expect(record.length).toBeGreaterThan(0);
    expect(record.every((r) => r.startsWith('bytes='))).toBe(true);
    expect(record[0]).toMatch(/^bytes=-\d+$/);
  });

  it('works when the server ignores Range (returns 200 full body)', async () => {
    const png = new Uint8Array([0x89, 0x50, 1]);
    stubFetchZip(buildZip([{ name: 'icon.png', data: png, method: 0 }]));
    const blob = await extractWebxdcIcon('https://x.test/app.xdc');
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(png.length);
  });

  it('falls back to a full fetch when Content-Range is not exposed', async () => {
    const png = new Uint8Array([0x89, 0x50, 2]);
    const record: string[] = [];
    stubFetchZip(buildZip([{ name: 'icon.png', data: png, method: 0 }]), {
      ranges: true,
      hideContentRange: true,
      record,
    });
    const blob = await extractWebxdcIcon('https://x.test/app.xdc');
    expect(blob?.type).toBe('image/png');
    expect(record).toContain('full'); // plain full fetch happened
  });

  it('returns undefined when the full body exceeds the size cap', async () => {
    stubFetchZip(new Uint8Array([1]), {
      fullBody: new ArrayBuffer(MAX_XDC_BYTES + 1),
      noContentLength: true, // exercise the byteLength check, not the header check
    });
    expect(await extractWebxdcIcon('https://x.test/big.xdc')).toBeUndefined();
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
