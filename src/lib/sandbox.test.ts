import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64, getMimeType, injectScriptTags, utf8ToBase64 } from '@/lib/sandbox';

describe('sandbox helpers', () => {
  it('round-trips binary through base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('encodes utf-8 strings', () => {
    expect(Array.from(base64ToBytes(utf8ToBase64('héllo')))).toEqual([104, 195, 169, 108, 108, 111]);
  });

  it('maps file extensions to MIME types', () => {
    expect(getMimeType('index.html')).toBe('text/html');
    expect(getMimeType('js/app.js')).toContain('javascript');
    expect(getMimeType('icon.png')).toBe('image/png');
  });

  it('injects script tags into <head> and keeps the doctype', () => {
    const html = '<!DOCTYPE html><html><head><title>x</title></head><body><p>hi</p></body></html>';
    const out = injectScriptTags(html, ['/webxdc.js']);
    expect(out.toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<script src="/webxdc.js"></script>');
    expect(out.indexOf('<script')).toBeLessThan(out.indexOf('<title>'));
    expect(out).toContain('<p>hi</p>');
  });
});
