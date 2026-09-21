/**
 * Deploy dist/ as a NIP-5A "nsite" (kind 15128 manifest + Blossom blobs),
 * served live by public gateways such as nsite.lol and nsite.run.
 *
 * Reuses the keypair/relay config that `nostr-deploy-cli` writes to
 * .env.nostr-deploy.local (auto-generates one if missing).
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey, SimplePool } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { nip19 } from 'nostr-tools';

const DIST = new URL('../dist', import.meta.url).pathname;
const ENV_FILE = new URL('../.env.nostr-deploy.local', import.meta.url).pathname;

function loadEnv() {
  const env = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  // Environment variables (e.g. CI secrets) take precedence over the local file.
  for (const key of ['NOSTR_PRIVATE_KEY', 'NOSTR_PUBLIC_KEY', 'NOSTR_RELAYS', 'BLOSSOM_SERVERS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (!env.NOSTR_PRIVATE_KEY) {
    if (process.env.CI) {
      console.error('NOSTR_PRIVATE_KEY is not set; refusing to deploy with a throwaway keypair in CI.');
      process.exit(1);
    }
    const sk = generateSecretKey();
    env.NOSTR_PRIVATE_KEY = bytesToHex(sk);
    env.NOSTR_PUBLIC_KEY = getPublicKey(sk);
    const saved = [
      '# Nostr Deploy CLI Configuration',
      '# This file contains sensitive information - do not commit to version control',
      '',
      '# Nostr Authentication',
      `NOSTR_PRIVATE_KEY=${env.NOSTR_PRIVATE_KEY}`,
      `NOSTR_PUBLIC_KEY=${env.NOSTR_PUBLIC_KEY}`,
      `NOSTR_RELAYS=${env.NOSTR_RELAYS ?? 'wss://nostrue.com,wss://purplerelay.com,wss://relay.primal.net,wss://nos.lol'}`,
      '',
      '# Blossom File Storage',
      `BLOSSOM_SERVERS=${env.BLOSSOM_SERVERS ?? 'https://cdn.hzrd149.com,https://blossom.band,https://blossom.primal.net'}`,
      '',
    ].join('\n');
    writeFileSync(ENV_FILE, saved, { mode: 0o600 });
    console.log('Generated new keypair (saved to .env.nostr-deploy.local — keep the nsec safe)');
  }
  return env;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Blossom blobs are content-addressed and many servers store/serve them
// untyped (text/plain or octet-stream); browsers refuse a stylesheet served
// as text/plain, so always send the real MIME type at upload time and prefer
// servers that honor it.
const MIME_TYPES = {
  html: 'text/html', htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', map: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  txt: 'text/plain', md: 'text/plain', xml: 'application/xml',
  wasm: 'application/wasm',
};

function contentTypeFor(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

async function blossomUpload(servers, skBytes, filePath, blob) {
  const hash = sha256(blob);
  const auth = finalizeEvent({
    kind: 24242, // BUD-02 upload authorization
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', String(Math.floor(Date.now() / 1000) + 600)],
    ],
    content: `Upload ${relative(DIST, filePath)}`,
  }, skBytes);
  const header = 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64');
  let lastErr;
  for (const server of servers) {
    try {
      const res = await fetch(`${server.replace(/\/$/, '')}/upload`, {
        method: 'PUT',
        headers: { authorization: header, 'content-type': contentTypeFor(filePath) },
        body: blob,
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const json = await res.json();
      return { server, sha256: json.sha256 ?? hash };
    } catch (e) {
      lastErr = e;
      console.warn(`  upload via ${server} failed: ${e.message}`);
    }
  }
  throw lastErr;
}

function secretKeyBytes(secret) {
  if (secret.startsWith('nsec1')) {
    const { type, data } = nip19.decode(secret);
    if (type !== 'nsec') throw new Error(`NOSTR_PRIVATE_KEY must be an nsec or hex key, got ${type}`);
    return data;
  }
  return hexToBytes(secret);
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const env = loadEnv();
const skBytes = secretKeyBytes(env.NOSTR_PRIVATE_KEY);
const pubkey = getPublicKey(skBytes);
const relays = (env.NOSTR_RELAYS ?? 'wss://nos.lol,wss://relay.primal.net').split(',');
const blossoms = (env.BLOSSOM_SERVERS ?? 'https://cdn.hzrd149.com').split(',');

const files = [...walk(DIST)].sort();
console.log(`Deploying ${files.length} files from dist/`);

const pathTags = [];
const usedServers = new Set();
for (const file of files) {
  const blob = readFileSync(file);
  const urlPath = '/' + relative(DIST, file).split('/').join('/');
  const { server, sha256: hash } = await blossomUpload(blossoms, skBytes, file, blob);
  usedServers.add(server);
  pathTags.push(['path', urlPath, hash, server.replace(/\/$/, '') + '/' + hash]);
  console.log(`  ${urlPath} -> ${hash.slice(0, 12)}… (${server})`);
}

const aggregate = sha256(Buffer.from(pathTags.map((t) => t.join(':')).join('\n')));

const manifest = finalizeEvent({
  kind: 15128, // NIP-5A root site manifest
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ...pathTags,
    ['x', aggregate],
    ['title', pkg.name],
    ...(process.env.GITHUB_REPOSITORY
      ? [['source', `https://github.com/${process.env.GITHUB_REPOSITORY}`]]
      : []),
    // Advertise only the servers that actually hold the blobs, in upload order,
    // so gateways try type-preserving servers first.
    ...[...usedServers].map((s) => ['server', s.replace(/\/$/, '')]),
  ],
  content: '',
}, skBytes);

const pool = new SimplePool();
const results = await Promise.allSettled(pool.publish(relays, manifest));
const ok = results.filter((r) => r.status === 'fulfilled').length;
pool.close(relays);
console.log(`Manifest published to ${ok}/${relays.length} relays`);

const npub = nip19.npubEncode(pubkey);
console.log('\nDeployed:');
console.log(`  https://${npub}.nsite.lol`);
console.log(`  https://${npub}.nsite.run`);
