import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-DC (Nostr Webxdc) helpers.
 * Spec: https://gitlab.com/soapbox-pub/dittoroma/-/raw/main/NOSTR_WEBXDC.md
 *
 * - A "webxdc app event" is any event carrying an `imeta` tag (NIP-92) with
 *   `m application/x-webxdc`, or a kind 1063 (NIP-94) file metadata event.
 *   The `webxdc` property/tag holds the coordination identifier.
 * - Kind 4932 is a state update (maps to webxdc `sendUpdate()`). It carries an
 *   `i` tag equal to the webxdc identifier, so `#i` is relay-filterable.
 * - Kind 20932 is ephemeral realtime data; relays do not store it.
 */

export const WEBXDC_MIME = 'application/x-webxdc';
export const WEBXDC_FILE_KIND = 1063;
export const WEBXDC_UPDATE_KIND = 4932;
export const WEBXDC_REALTIME_KIND = 20932;

export interface WebxdcAttachment {
  url: string;
  mime: string;
  /** sha256 of the .xdc file (imeta `x`), when present */
  sha256?: string;
  /** webxdc coordination identifier (imeta `webxdc` prop or `webxdc` tag) */
  identifier?: string;
}

/** Parse an imeta tag's `"key value"` pairs into a record. */
export function parseImeta(tag: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of tag.slice(1)) {
    const idx = field.indexOf(' ');
    if (idx === -1) continue;
    map[field.slice(0, idx)] = field.slice(idx + 1);
  }
  return map;
}

export function getTagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

/** All webxdc attachments on an event (from imeta tags or kind-1063 url/m tags). */
export function getWebxdcAttachments(event: NostrEvent): WebxdcAttachment[] {
  const out: WebxdcAttachment[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue;
    const fields = parseImeta(tag);
    if (fields.m !== WEBXDC_MIME || !fields.url) continue;
    out.push({ url: fields.url, mime: fields.m, sha256: fields.x, identifier: fields.webxdc });
  }
  if (out.length === 0 && event.kind === WEBXDC_FILE_KIND && getTagValue(event, 'm') === WEBXDC_MIME) {
    const url = getTagValue(event, 'url');
    if (url) {
      out.push({
        url,
        mime: WEBXDC_MIME,
        sha256: getTagValue(event, 'x'),
        identifier: getTagValue(event, 'webxdc'),
      });
    }
  }
  return out;
}

export function isWebxdcAppEvent(event: NostrEvent): boolean {
  return getWebxdcAttachments(event).length > 0;
}

/** webxdc coordination identifier for the first attachment, if any. */
export function getWebxdcId(event: NostrEvent): string | undefined {
  return getWebxdcAttachments(event)[0]?.identifier;
}

export function getWebxdcUrl(event: NostrEvent): string | undefined {
  return getWebxdcAttachments(event)[0]?.url;
}

/** Display name: `alt` tag, else the .xdc filename, else a fallback. */
export function getWebxdcName(event: NostrEvent): string {
  const alt = getTagValue(event, 'alt');
  if (alt) return alt.replace(/^webxdc app:\s*/i, '');
  const url = getWebxdcUrl(event);
  if (url) {
    try {
      const file = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
      if (file) return file.replace(/\.xdc$/i, '');
    } catch {
      // malformed URL — fall through
    }
  }
  return 'webxdc app';
}

export interface WebxdcUpdate {
  /** webxdc coordination identifier (`i` tag) */
  identifier: string;
  info?: string;
  document?: string;
  summary?: string;
  /** JSON.parse'd content payload from sendUpdate(), or undefined if not JSON */
  payload: unknown;
}

export function parseWebxdcUpdate(event: NostrEvent): WebxdcUpdate | undefined {
  if (event.kind !== WEBXDC_UPDATE_KIND) return undefined;
  const identifier = getTagValue(event, 'i');
  if (!identifier) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(event.content);
  } catch {
    payload = undefined;
  }
  return {
    identifier,
    info: getTagValue(event, 'info'),
    document: getTagValue(event, 'document'),
    summary: getTagValue(event, 'summary'),
    payload,
  };
}

/** Updates are ordered by created_at (serial = index + 1), tie-broken by id. */
export function sortWebxdcUpdates<T extends NostrEvent>(events: T[]): T[] {
  return [...events].sort(
    (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
  );
}
