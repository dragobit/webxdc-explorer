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
  if (!env.NOSTR_PRIVATE_KEY) {
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
      `BLOSSOM_SERVERS=${env.BLOSSOM_SERVERS ?? 'https://blossom.primal.net,https://blossom.band,https://cdn.hzrd149.com'}`,
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
        headers: { authorization: header, 'content-type': 'application/octet-stream' },
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

const env = loadEnv();
const skBytes = hexToBytes(env.NOSTR_PRIVATE_KEY);
const pubkey = env.NOSTR_PUBLIC_KEY ?? getPublicKey(skBytes);
const relays = (env.NOSTR_RELAYS ?? 'wss://nos.lol,wss://relay.primal.net').split(',');
const blossoms = (env.BLOSSOM_SERVERS ?? 'https://blossom.primal.net').split(',');

const files = [...walk(DIST)].sort();
console.log(`Deploying ${files.length} files from dist/`);

const pathTags = [];
for (const file of files) {
  const blob = readFileSync(file);
  const urlPath = '/' + relative(DIST, file).split('/').join('/');
  const { server, sha256: hash } = await blossomUpload(blossoms, skBytes, file, blob);
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
    ['title', 'MKStack app'],
    ['source', 'https://github.com/dragobit/mkstack-devin'],
    ...blossoms.map((s) => ['server', s.replace(/\/$/, '')]),
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
