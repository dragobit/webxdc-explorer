import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Public iframe.diy wildcard host used for origin isolation of sandboxed apps. */
export const SANDBOX_DOMAIN: string = import.meta.env.VITE_SANDBOX_DOMAIN || 'iframe.diy';

/** Fixed length of a base36-encoded 32-byte value. */
const BASE36_LENGTH = 50;

function hexToBase36(hex: string): string {
  let n = 0n;
  for (let i = 0; i < hex.length; i++) {
    n = n * 16n + BigInt(parseInt(hex[i], 16));
  }
  return n.toString(36).padStart(BASE36_LENGTH, '0');
}

const SEED_KEY = 'webxdc-explorer:sandbox-seed';

/** Per-page-load fallback when localStorage is unavailable. */
const EPHEMERAL_SEED = crypto.randomUUID();

/**
 * Device-local random seed. Keeps per-app sandbox subdomains unguessable so
 * one app cannot reach another app's origin-keyed storage.
 */
function getSeed(): string {
  try {
    const stored = localStorage.getItem(SEED_KEY);
    if (stored) return stored;
    const seed = crypto.randomUUID();
    localStorage.setItem(SEED_KEY, seed);
    return seed;
  } catch {
    return EPHEMERAL_SEED;
  }
}

/** Stable, private subdomain label (50-char base36) for a sandbox frame. */
export function deriveIframeSubdomain(prefix: string, identifier: string): string {
  const enc = new TextEncoder();
  const mac = hmac(sha256, enc.encode(getSeed()), enc.encode(`${prefix}|${identifier}`));
  return hexToBase36(bytesToHex(mac));
}
