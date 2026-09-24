import { describe, expect, it } from 'vitest';

import { sanitizeFileName, xdcFileToFile, SEND_FILE_MAX_BYTES } from '@/lib/xdcFile';
import { bytesToBase64 } from '@/lib/sandbox';

describe('sanitizeFileName', () => {
  it('strips path separators and control characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFileName('a\\b.txt')).toBe('a_b.txt');
    expect(sanitizeFileName('nulbyte')).toBe('nul_byte');
  });

  it('falls back to a default name', () => {
    expect(sanitizeFileName('   ')).toBe('file');
    expect(sanitizeFileName('')).toBe('file');
  });
});

describe('xdcFileToFile', () => {
  it('converts plainText into a text File', async () => {
    const f = xdcFileToFile({ name: 'note.txt', plainText: 'hello' });
    expect(f.name).toBe('note.txt');
    expect(f.type).toBe('text/plain');
    expect(await f.text()).toBe('hello');
  });

  it('converts base64 into a typed File', async () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    const f = xdcFileToFile({ name: 'img.png', base64: bytesToBase64(bytes) });
    expect(f.name).toBe('img.png');
    expect(f.type).toBe('image/png');
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(bytes);
  });

  it('converts a Blob into a File keeping its type', async () => {
    const f = xdcFileToFile({ name: 'a.bin', blob: new Blob(['xy'], { type: 'application/zip' }) });
    expect(f.name).toBe('a.bin');
    expect(f.type).toBe('application/zip');
    expect(await f.text()).toBe('xy');
  });

  it('sanitises the name and guesses MIME from the extension', () => {
    const f = xdcFileToFile({ name: '../x.md', blob: new Blob(['t'], { type: '' }) });
    expect(f.name).toBe('.._x.md');
    expect(f.type).toBe('text/markdown');
  });

  it('respects the size ceiling constant', () => {
    expect(SEND_FILE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
