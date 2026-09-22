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
export const MAX_XDC_BYTES = 25 * 1024 * 1024;
const TAIL_BYTES = 64 * 1024;

interface IconEntry {
  name: string;
  method: number;
  /** compressed size */
  size: number;
  /** absolute offset of the local file header */
  offset: number;
  /** name/extra lengths as recorded in the central directory */
  cdNameLen: number;
  cdExtraLen: number;
}

/** Find the End Of Central Directory signature by scanning backwards. */
function findEocd(dv: DataView): number {
  for (let i = dv.byteLength - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Iterate central-directory entries inside `bytes` (whose first byte
 * corresponds to absolute file offset `baseOffset`) starting at the absolute
 * `cdOffset`. Returns the icon entry (prefer icon.png) or undefined.
 */
function findIconEntry(
  bytes: Uint8Array<ArrayBuffer>,
  baseOffset: number,
  cdOffset: number,
  entryCount: number,
): IconEntry | undefined {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rel = cdOffset - baseOffset;
  let iconPng: IconEntry | undefined;
  let iconJpg: IconEntry | undefined;
  for (let i = 0; i < entryCount; i++) {
    if (rel < 0 || rel + 46 > bytes.length || dv.getUint32(rel, true) !== CDE_SIG) break;
    const method = dv.getUint16(rel + 10, true);
    const size = dv.getUint32(rel + 20, true); // compressed size
    const nameLen = dv.getUint16(rel + 28, true);
    const extraLen = dv.getUint16(rel + 30, true);
    const commentLen = dv.getUint16(rel + 32, true);
    const offset = dv.getUint32(rel + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(rel + 46, rel + 46 + nameLen));
    if (name === 'icon.png') iconPng ??= { name, method, size, offset, cdNameLen: nameLen, cdExtraLen: extraLen };
    else if (name === 'icon.jpg') iconJpg ??= { name, method, size, offset, cdNameLen: nameLen, cdExtraLen: extraLen };
    rel += 46 + nameLen + extraLen + commentLen;
  }
  return iconPng ?? iconJpg;
}

/**
 * Read the local file header for `entry` inside `bytes` (first byte = absolute
 * `baseOffset`), slice the compressed data, and decompress into an image Blob.
 */
async function iconBlobFromLocal(
  bytes: Uint8Array<ArrayBuffer>,
  baseOffset: number,
  entry: IconEntry,
): Promise<Blob | undefined> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rel = entry.offset - baseOffset;
  if (rel < 0 || rel + 30 > bytes.length || dv.getUint32(rel, true) !== LFH_SIG) {
    return undefined;
  }
  // The LOCAL header's name/extra lengths may differ from the CD's.
  const nameLen = dv.getUint16(rel + 26, true);
  const extraLen = dv.getUint16(rel + 28, true);
  const dataStart = rel + 30 + nameLen + extraLen;
  if (dataStart + entry.size > bytes.length) return undefined;
  const slice = bytes.subarray(dataStart, dataStart + entry.size);

  let data: ArrayBuffer;
  if (entry.method === 0) {
    data = slice.slice().buffer as ArrayBuffer;
  } else if (entry.method === 8) {
    const ds = new DecompressionStream('deflate-raw');
    const body = new Response(new Uint8Array(slice).buffer).body;
    if (!body) return undefined;
    data = await new Response(body.pipeThrough(ds)).arrayBuffer();
  } else {
    return undefined;
  }

  return new Blob([data], {
    type: entry.name === 'icon.png' ? 'image/png' : 'image/jpeg',
  });
}

/** Whole-file path: `bytes` is the complete .xdc. */
async function iconFromWholeFile(bytes: Uint8Array<ArrayBuffer>): Promise<Blob | undefined> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(dv);
  if (eocd === -1) return undefined;
  const entryCount = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff) return undefined; // ZIP64 unsupported
  const entry = findIconEntry(bytes, 0, cdOffset, entryCount);
  if (!entry) return undefined;
  return iconBlobFromLocal(bytes, 0, entry);
}

async function fetchRange(
  url: string,
  range: string,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const res = await fetch(url, { signal, headers: { Range: range } });
  if (res.status !== 206) return undefined;
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Extract `icon.png`/`icon.jpg` (webxdc spec, ZIP root) from a .xdc file.
 * Tries HTTP Range requests first to avoid downloading the whole archive,
 * falling back to a full fetch. Returns undefined on any failure — never throws.
 */
export async function extractWebxdcIcon(
  xdcUrl: string,
  signal?: AbortSignal,
): Promise<Blob | undefined> {
  try {
    const res = await fetch(xdcUrl, { signal, headers: { Range: `bytes=-${TAIL_BYTES}` } });
    if (res.status === 200) {
      // Server ignored Range — this response IS the whole file.
      const len = Number(res.headers.get('content-length'));
      if (len > MAX_XDC_BYTES) return undefined;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_XDC_BYTES) return undefined;
      return await iconFromWholeFile(new Uint8Array(buf));
    }
    if (!res.ok && res.status !== 206) return undefined;

    if (res.status === 206) {
      const m = res.headers.get('content-range')?.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (m) {
        const total = Number(m[3]);
        if (total > MAX_XDC_BYTES) return undefined;
        const tail = new Uint8Array(await res.arrayBuffer());
        const tailBase = total - tail.length;
        const tailDv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
        const eocd = findEocd(tailDv);
        if (eocd !== -1) {
          const entryCount = tailDv.getUint16(eocd + 10, true);
          const cdSize = tailDv.getUint32(eocd + 12, true);
          const cdOffset = tailDv.getUint32(eocd + 16, true);
          if (cdOffset !== 0xffffffff && cdSize !== 0xffffffff) {
            let cdBytes = tail;
            let cdBase = tailBase;
            let ok = true;
            if (cdOffset < tailBase) {
              const fetched = await fetchRange(xdcUrl, `bytes=${cdOffset}-${cdOffset + cdSize - 1}`, signal);
              if (fetched) {
                cdBytes = fetched;
                cdBase = cdOffset;
              } else {
                ok = false;
              }
            }
            if (ok) {
              const entry = findIconEntry(cdBytes, cdBase, cdOffset, entryCount);
              if (entry) {
                const want = 30 + entry.cdNameLen + entry.cdExtraLen + entry.size + 1024;
                const local = await fetchRange(
                  xdcUrl,
                  `bytes=${entry.offset}-${entry.offset + want - 1}`,
                  signal,
                );
                if (local) {
                  const blob = await iconBlobFromLocal(local, entry.offset, entry);
                  if (blob) return blob;
                }
              }
            }
          }
        }
      }
      // 206 without readable Content-Range, or a failed range step → full fetch.
    }

    // Fallback: plain full fetch.
    const full = await fetch(xdcUrl, { signal });
    if (!full.ok) return undefined;
    const fullLen = Number(full.headers.get('content-length'));
    if (fullLen > MAX_XDC_BYTES) return undefined;
    const buf = await full.arrayBuffer();
    if (buf.byteLength > MAX_XDC_BYTES) return undefined;
    return await iconFromWholeFile(new Uint8Array(buf));
  } catch {
    return undefined;
  }
}
