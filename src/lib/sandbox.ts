/**
 * Helpers for the iframe.diy sandbox protocol (JSON-RPC 2.0 over postMessage).
 * Spec: https://gitlab.com/soapbox-pub/iframe.diy
 */

export interface SerialisedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** The result of resolving a file request inside the sandbox. */
export interface FileResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.opus': 'audio/opus',
  '.weba': 'audio/webm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.toml': 'application/toml',
};

export function getMimeType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return MIME_TYPES[path.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function utf8ToBase64(str: string): string {
  return bytesToBase64(new TextEncoder().encode(str));
}

/**
 * Prepend `<script src>` tags into `<head>` of an HTML document so the
 * injected scripts run before the app's own scripts.
 */
export function injectScriptTags(html: string, scriptPaths: string[]): string {
  if (scriptPaths.length === 0) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (let i = scriptPaths.length - 1; i >= 0; i--) {
    const script = doc.createElement('script');
    script.src = scriptPaths[i];
    doc.head.prepend(script);
  }
  const hasDoctype = /^<!doctype\s/i.test(html.trimStart());
  const serialised = doc.documentElement.outerHTML;
  return hasDoctype ? '<!DOCTYPE html>\n' + serialised : serialised;
}
