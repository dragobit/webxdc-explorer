import type { NostrEvent } from '@nostrify/nostrify';

import { parseImeta } from '@/lib/webxdc';

function isHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Preview image for a webxdc app event. Prefer the webxdc imeta tag's NIP-92
 * `image`/`thumb` fields; fall back to the `url` of any other imeta tag whose
 * MIME starts with `image/`. Only https URLs are returned.
 */
export function getWebxdcPreviewImage(event: NostrEvent): string | undefined {
  let webxdcPreview: string | undefined;
  let imageUrl: string | undefined;
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue;
    const fields = parseImeta(tag);
    const mime = fields.m ?? '';
    if (mime === 'application/x-webxdc') {
      if (isHttpsUrl(fields.image)) webxdcPreview = fields.image;
      else if (!webxdcPreview && isHttpsUrl(fields.thumb)) webxdcPreview = fields.thumb;
    } else if (mime.startsWith('image/') && isHttpsUrl(fields.url) && !imageUrl) {
      imageUrl = fields.url;
    }
  }
  return webxdcPreview ?? imageUrl;
}

const EOCD_SIG = 0x06054b50;
const CDE_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const MAX_XDC_BYTES = 25 * 1024 * 1024;

/**
 * Extract `icon.png`/`icon.jpg` (webxdc spec, ZIP root) from a .xdc file.
 * Returns undefined on any failure — never throws.
 */
export async function extractWebxdcIcon(
  xdcUrl: string,
  signal?: AbortSignal,
): Promise<Blob | undefined> {
  try {
    const res = await fetch(xdcUrl, { signal });
    if (!res.ok) return undefined;
    const len = Number(res.headers.get('content-length'));
    if (len > MAX_XDC_BYTES) return undefined;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const dv = new DataView(buf);

    // Locate End Of Central Directory by scanning backwards for its signature.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) return undefined;

    const entryCount = dv.getUint16(eocd + 10, true);
    let cdOffset = dv.getUint32(eocd + 16, true);
    if (cdOffset === 0xffffffff) return undefined; // ZIP64 unsupported

    // Collect central-directory entries for icon.png / icon.jpg (prefer png).
    const found: { name: string; method: number; size: number; offset: number }[] = [];
    for (let i = 0; i < entryCount; i++) {
      if (cdOffset + 46 > bytes.length || dv.getUint32(cdOffset, true) !== CDE_SIG) break;
      const method = dv.getUint16(cdOffset + 10, true);
      const size = dv.getUint32(cdOffset + 20, true); // compressed size
      const nameLen = dv.getUint16(cdOffset + 28, true);
      const extraLen = dv.getUint16(cdOffset + 30, true);
      const commentLen = dv.getUint16(cdOffset + 32, true);
      const offset = dv.getUint32(cdOffset + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      if (name === 'icon.png' || name === 'icon.jpg') {
        found.push({ name, method, size, offset });
      }
      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    found.sort((a, b) => (a.name === 'icon.png' ? -1 : 0) - (b.name === 'icon.png' ? -1 : 0));
    const entry = found.find((f) => f.name === 'icon.png') ?? found[0];
    if (!entry) return undefined;
    if (entry.offset + 30 > bytes.length || dv.getUint32(entry.offset, true) !== LFH_SIG) {
      return undefined;
    }

    const nameLen = dv.getUint16(entry.offset + 26, true);
    const extraLen = dv.getUint16(entry.offset + 28, true);
    const dataStart = entry.offset + 30 + nameLen + extraLen;
    if (dataStart + entry.size > bytes.length) return undefined;
    const slice = bytes.subarray(dataStart, dataStart + entry.size);

    let data: ArrayBuffer;
    if (entry.method === 0) {
      data = slice.slice().buffer as ArrayBuffer;
    } else if (entry.method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const body = new Response(slice).body;
      if (!body) return undefined;
      data = await new Response(body.pipeThrough(ds)).arrayBuffer();
    } else {
      return undefined;
    }

    return new Blob([data], {
      type: entry.name === 'icon.png' ? 'image/png' : 'image/jpeg',
    });
  } catch {
    return undefined;
  }
}
