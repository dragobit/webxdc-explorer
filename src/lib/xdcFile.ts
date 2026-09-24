import type { XDCFile } from '@webxdc/types/webxdc';

import { base64ToBytes, getMimeType } from '@/lib/sandbox';

/** Max size of a file an app may hand to `sendToChat`. */
export const SEND_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Max chars of `sendToChat` message text. */
export const SEND_TEXT_MAX_CHARS = 4000;
/** Max total size of files returned by `importFiles`. */
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Strip path separators and control characters from an untrusted file name
 * coming out of the sandboxed app.
 */
export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
  return cleaned || 'file';
}

/** Convert a webxdc `XDCFile` (`plainText` | `base64` | `blob`) into a `File`. */
export function xdcFileToFile(xdc: XDCFile): File {
  const name = sanitizeFileName(xdc.name);
  if ('plainText' in xdc) {
    return new File([xdc.plainText], name, { type: 'text/plain' });
  }
  if ('base64' in xdc) {
    const bytes = base64ToBytes(xdc.base64);
    return new File([bytes.buffer as ArrayBuffer], name, { type: getMimeType(name) });
  }
  return new File([xdc.blob], name, { type: xdc.blob.type || getMimeType(name) });
}
