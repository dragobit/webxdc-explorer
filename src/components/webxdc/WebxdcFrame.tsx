import { useCallback, useEffect, useRef, type IframeHTMLAttributes } from 'react';
import { unzipSync } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Webxdc as WebxdcAPI, ReceivedStatusUpdate, RealtimeListener, XDCFile } from '@webxdc/types/webxdc';

import { SandboxFrame } from '@/components/webxdc/SandboxFrame';
import { SANDBOX_DOMAIN } from '@/lib/iframeSubdomain';
import { getMimeType, injectScriptTags } from '@/lib/sandbox';
import type { FileResponse } from '@/lib/sandbox';

export interface WebxdcFrameProps
  extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'id'> {
  /** Sandbox subdomain label (see `deriveIframeSubdomain`). */
  id: string;
  /** https URL of the `.xdc` archive. */
  xdcUrl: string;
  /** Expected sha256 (hex) of the archive; verified before unzip when set. */
  sha256?: string;
  /** Backs the iframe's `window.webxdc` calls. */
  webxdc: WebxdcAPI<unknown>;
  onLoadError?: (err: Error) => void;
}

/** Ceiling on a `.xdc` bundle (compressed). */
const MAX_XDC_BYTES = 100 * 1024 * 1024;
/** Ceilings on the unpacked archive, per entry and in total. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
/** Realtime frames are capped by the webxdc spec. */
const MAX_REALTIME_BYTES = 128_000;
/** Limits on user-mediated sendToChat / importFiles requests. */
const MAX_SEND_TEXT = 4000;
const MAX_SEND_FILE_BYTES = 10 * 1024 * 1024;
const EXT_RE = /^\.[A-Za-z0-9]+$/;

/** webxdc spec: all internet access is denied. */
const WEBXDC_CSP = [
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

async function fetchXdc(url: string, expectedSha256?: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download .xdc (${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_XDC_BYTES) throw new Error('.xdc exceeds size limit');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_XDC_BYTES) throw new Error('.xdc exceeds size limit');
  if (expectedSha256) {
    const actual = bytesToHex(sha256(bytes));
    if (actual !== expectedSha256.toLowerCase()) {
      throw new Error('.xdc hash does not match the imeta x tag');
    }
  }
  return bytes;
}

function unzipXdc(bytes: Uint8Array): Map<string, Uint8Array> {
  let total = 0;
  const unzipped = unzipSync(bytes, {
    filter: (file) => {
      if (file.originalSize > MAX_ENTRY_BYTES) throw new Error(`.xdc entry too large: ${file.name}`);
      total += file.originalSize;
      if (total > MAX_UNPACKED_BYTES) throw new Error('.xdc unpacked size exceeds limit');
      return true;
    },
  });
  const fileMap = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(unzipped)) {
    const normalised = path.replace(/^\/+/, '').replace(/\\/g, '/');
    if (normalised.endsWith('/')) continue;
    fileMap.set(normalised, content);
  }
  return fileMap;
}

/**
 * Bridge script injected into every HTML file of the archive. Implements
 * `window.webxdc` by sending JSON-RPC requests to the parent window.
 */
function generateWebxdcBridge(api: WebxdcAPI<unknown>, parentOrigin: string): string {
  return `(function(){
  var PARENT_ORIGIN = ${JSON.stringify(parentOrigin)};
  var nextId = 1;
  var pending = {};
  var updateListener = null;
  var realtimeDataListener = null;
  var realtimeChannelId = null;
  var identity = { selfAddr: ${JSON.stringify(api.selfAddr)}, selfName: ${JSON.stringify(api.selfName)} };

  function send(msg) { window.parent.postMessage(msg, PARENT_ORIGIN); }

  function sendRequest(method, params) {
    var id = nextId++;
    return new Promise(function(resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      send({ jsonrpc: "2.0", id: id, method: method, params: params });
    });
  }

  window.addEventListener("message", function(event) {
    if (event.source !== window.parent || event.origin !== PARENT_ORIGIN) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") return;
    if (data.id !== undefined && !data.method) {
      var p = pending[data.id];
      if (p) {
        delete pending[data.id];
        if (data.error) p.reject(new Error(data.error.message));
        else p.resolve(data.result);
      }
      return;
    }
    if (data.method && data.id === undefined) {
      switch (data.method) {
        case "webxdc.update":
          if (updateListener) updateListener(data.params.update);
          break;
        case "webxdc.realtimeChannel.data":
          if (realtimeDataListener) realtimeDataListener(new Uint8Array(data.params.data));
          break;
        case "webxdc.identity":
          identity = data.params.identity;
          break;
      }
    }
  });

  window.webxdc = {
    get selfAddr() { return identity.selfAddr; },
    get selfName() { return identity.selfName; },
    sendUpdateInterval: ${api.sendUpdateInterval},
    sendUpdateMaxSize: ${api.sendUpdateMaxSize},
    sendUpdate: function(update, descr) {
      sendRequest("webxdc.sendUpdate", { update: update, descr: descr });
    },
    setUpdateListener: function(cb, serial) {
      updateListener = cb;
      return sendRequest("webxdc.setUpdateListener", { serial: serial || 0 }).then(function() {});
    },
    getAllUpdates: function() { return sendRequest("webxdc.getAllUpdates"); },
    sendToChat: function(message) { return sendRequest("webxdc.sendToChat", { message: message }); },
    importFiles: function(filter) { return sendRequest("webxdc.importFiles", { filter: filter || {} }); },
    joinRealtimeChannel: function() {
      if (realtimeChannelId) throw new Error("Already joined a realtime channel. Leave first.");
      var channelIdPromise = sendRequest("webxdc.joinRealtimeChannel");
      var joined = true;
      channelIdPromise.then(function(r) { realtimeChannelId = r.channelId; });
      return {
        setListener: function(cb) {
          if (!joined) throw new Error("Channel has been left.");
          realtimeDataListener = cb;
        },
        send: function(data) {
          if (!joined) throw new Error("Channel has been left.");
          channelIdPromise.then(function(r) {
            sendRequest("webxdc.realtimeChannel.send", { channelId: r.channelId, data: Array.from(data) });
          });
        },
        leave: function() {
          if (!joined) return;
          joined = false;
          realtimeDataListener = null;
          channelIdPromise.then(function(r) {
            sendRequest("webxdc.realtimeChannel.leave", { channelId: r.channelId });
            realtimeChannelId = null;
          });
        }
      };
    }
  };
})();`;
}

interface RpcParams {
  update?: unknown;
  serial?: number;
  message?: unknown;
  filter?: unknown;
  channelId?: string;
  data?: unknown;
}

type OutgoingUpdate = Parameters<WebxdcAPI<unknown>['sendUpdate']>[0];
type SendOptions = Parameters<WebxdcAPI<unknown>['sendToChat']>[0];
type ImportFilesFilter = Parameters<WebxdcAPI<unknown>['importFiles']>[0];

/** Validates an untrusted `sendToChat` argument coming from the iframe. */
function parseSendOptions(raw: unknown): SendOptions {
  if (!raw || typeof raw !== 'object') throw new Error('message must be an object');
  const rec = raw as Record<string, unknown>;
  const out: { text?: string; file?: XDCFile } = {};
  if (rec.text !== undefined && rec.text !== null) {
    if (typeof rec.text !== 'string') throw new Error('message.text must be a string');
    if (rec.text.length > MAX_SEND_TEXT) throw new Error('message.text too long');
    out.text = rec.text;
  }
  if (rec.file !== undefined && rec.file !== null) {
    const f = rec.file as Record<string, unknown>;
    if (!f || typeof f !== 'object') throw new Error('message.file must be an object');
    if (typeof f.name !== 'string' || f.name.length === 0 || f.name.length > 255) {
      throw new Error('message.file.name invalid');
    }
    const variants = ['plainText', 'base64', 'blob'].filter((k) => f[k] !== undefined && f[k] !== null);
    if (variants.length !== 1) throw new Error('message.file needs exactly one of plainText/base64/blob');
    if (variants[0] === 'plainText') {
      if (typeof f.plainText !== 'string') throw new Error('file.plainText must be a string');
      if (f.plainText.length > MAX_SEND_FILE_BYTES) throw new Error('file too large');
      out.file = { name: f.name, plainText: f.plainText };
    } else if (variants[0] === 'base64') {
      if (typeof f.base64 !== 'string') throw new Error('file.base64 must be a string');
      out.file = { name: f.name, base64: f.base64 };
    } else {
      if (!(f.blob instanceof Blob)) throw new Error('file.blob must be a Blob');
      if (f.blob.size > MAX_SEND_FILE_BYTES) throw new Error('file too large');
      out.file = { name: f.name, blob: f.blob };
    }
  }
  if (out.text === undefined && out.file === undefined) throw new Error('message needs text or file');
  return out as SendOptions;
}

/** Validates an untrusted `importFiles` filter coming from the iframe. */
function parseImportFilter(raw: unknown): ImportFilesFilter {
  const out: { extensions?: string[]; mimeTypes?: string[]; multiple?: boolean } = {};
  if (!raw || typeof raw !== 'object') return out;
  const rec = raw as Record<string, unknown>;
  if (Array.isArray(rec.extensions)) {
    out.extensions = rec.extensions.filter((e): e is string => typeof e === 'string' && EXT_RE.test(e));
  }
  if (Array.isArray(rec.mimeTypes)) {
    out.mimeTypes = rec.mimeTypes.filter((m): m is string => typeof m === 'string' && m.length <= 100);
  }
  if (typeof rec.multiple === 'boolean') out.multiple = rec.multiple;
  return out;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`update.${name} must be a string`);
  return value;
}

/** Validates an untrusted `sendUpdate` argument coming from the iframe. */
function parseOutgoingUpdate(raw: unknown, maxSize: number): OutgoingUpdate {
  if (!raw || typeof raw !== 'object') throw new Error('update must be an object');
  const rec = raw as Record<string, unknown>;
  if (!('payload' in rec)) throw new Error('update.payload is required');
  const payload = rec.payload;
  if (JSON.stringify(payload).length > maxSize) throw new Error('update exceeds sendUpdateMaxSize');
  const update: OutgoingUpdate = { payload };
  const info = optionalString(rec.info, 'info');
  const document = optionalString(rec.document, 'document');
  const summary = optionalString(rec.summary, 'summary');
  if (info !== undefined) update.info = info;
  if (document !== undefined) update.document = document;
  if (summary !== undefined) update.summary = summary;
  return update;
}

function parseBytes(raw: unknown): Uint8Array {
  if (!Array.isArray(raw)) throw new Error('data must be a byte array');
  if (raw.length > MAX_REALTIME_BYTES) throw new Error('Realtime payload exceeds 128,000 byte limit');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v: unknown = raw[i];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) {
      throw new Error('data must contain bytes (0-255)');
    }
    bytes[i] = v;
  }
  return bytes;
}

/**
 * Runs a webxdc app in a sandboxed iframe: downloads + unzips the `.xdc`,
 * serves its files through the sandbox fetch proxy, injects the webxdc bridge
 * into HTML, and routes `webxdc.*` RPC calls to the given API instance.
 */
export function WebxdcFrame({ id, xdcUrl, sha256: expectedSha256, webxdc, onLoadError, ...iframeProps }: WebxdcFrameProps) {
  const webxdcRef = useRef(webxdc);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => {
    webxdcRef.current = webxdc;
    onLoadErrorRef.current = onLoadError;
  }, [webxdc, onLoadError]);

  const fileMapRef = useRef<Map<string, Uint8Array> | null>(null);
  const bridgeScriptRef = useRef('');
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const realtimeChannels = useRef<Map<string, RealtimeListener>>(new Map());
  const postRef = useRef<((msg: Record<string, unknown>) => void) | null>(null);

  // Push identity changes (e.g. login after Run) into the live frame so
  // `webxdc.selfAddr`/`selfName` stay current without a Stop/Run cycle.
  useEffect(() => {
    postRef.current?.({
      jsonrpc: '2.0',
      method: 'webxdc.identity',
      params: { identity: { selfAddr: webxdc.selfAddr, selfName: webxdc.selfName } },
    });
  }, [webxdc.selfAddr, webxdc.selfName]);

  // Each `ready` is a fresh document; realtime state that belonged to the
  // previous one must not survive it.
  const leaveAllChannels = useCallback(() => {
    for (const ch of realtimeChannels.current.values()) ch.leave();
    realtimeChannels.current.clear();
  }, []);

  useEffect(() => leaveAllChannels, [leaveAllChannels]);

  const onReady = useCallback(() => {
    leaveAllChannels();
    loadPromiseRef.current ??= (async () => {
      try {
        const bytes = await fetchXdc(xdcUrl, expectedSha256);
        fileMapRef.current = unzipXdc(bytes);
        // The app's window.parent is the iframe.diy loader on the sandbox
        // origin, which relays our RPCs to this page. The bridge must
        // therefore target the sandbox origin, not this page's origin.
        bridgeScriptRef.current = generateWebxdcBridge(
          webxdcRef.current,
          `https://${id}.${SANDBOX_DOMAIN}`,
        );
      } catch (err) {
        console.error('[WebxdcFrame] Failed to initialise:', err);
        onLoadErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
        loadPromiseRef.current = null;
      }
    })();
    return loadPromiseRef.current;
  }, [id, xdcUrl, expectedSha256, leaveAllChannels]);

  const resolveFile = useCallback(async (pathname: string): Promise<FileResponse | null> => {
    if (pathname === '/webxdc.js') {
      return {
        status: 200,
        contentType: 'application/javascript',
        body: new TextEncoder().encode(bridgeScriptRef.current),
      };
    }
    const fileMap = fileMapRef.current;
    if (!fileMap) {
      return { status: 503, contentType: 'text/plain', body: new TextEncoder().encode('Archive not loaded') };
    }
    const filePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const fileBytes = fileMap.get(filePath);
    if (!fileBytes) return null;

    const contentType = getMimeType(filePath);
    if (contentType === 'text/html') {
      const html = new TextDecoder().decode(fileBytes);
      return { status: 200, contentType, body: new TextEncoder().encode(injectScriptTags(html, ['/webxdc.js'])) };
    }
    return { status: 200, contentType, body: fileBytes };
  }, []);

  const onRpc = useCallback(
    async (method: string, rawParams: unknown, post: (msg: Record<string, unknown>) => void): Promise<unknown> => {
      const api = webxdcRef.current;
      const params = (rawParams ?? {}) as RpcParams;

      switch (method) {
        case 'webxdc.sendUpdate':
          api.sendUpdate(parseOutgoingUpdate(params.update, api.sendUpdateMaxSize ?? 65536), '');
          return null;

        case 'webxdc.setUpdateListener':
          await api.setUpdateListener((update: ReceivedStatusUpdate<unknown>) => {
            post({ jsonrpc: '2.0', method: 'webxdc.update', params: { update } });
          }, params.serial ?? 0);
          return null;

        case 'webxdc.getAllUpdates':
          return await api.getAllUpdates();

        case 'webxdc.sendToChat':
          await api.sendToChat(parseSendOptions(params.message));
          return null;

        case 'webxdc.importFiles':
          return await api.importFiles(parseImportFilter(params.filter));

        case 'webxdc.joinRealtimeChannel': {
          if (!api.joinRealtimeChannel) throw new Error('Realtime channels are not supported');
          const rt = api.joinRealtimeChannel();
          const channelId = crypto.randomUUID();
          rt.setListener((data: Uint8Array) => {
            post({
              jsonrpc: '2.0',
              method: 'webxdc.realtimeChannel.data',
              params: { channelId, data: Array.from(data) },
            });
          });
          realtimeChannels.current.set(channelId, rt);
          return { channelId };
        }

        case 'webxdc.realtimeChannel.send': {
          const ch = params.channelId ? realtimeChannels.current.get(params.channelId) : undefined;
          if (ch) ch.send(parseBytes(params.data));
          return null;
        }

        case 'webxdc.realtimeChannel.leave': {
          const ch = params.channelId ? realtimeChannels.current.get(params.channelId) : undefined;
          if (ch && params.channelId) {
            ch.leave();
            realtimeChannels.current.delete(params.channelId);
          }
          return null;
        }

        default:
          throw new Error(`Method not found: ${method}`);
      }
    },
    [],
  );

  return (
    <SandboxFrame
      id={id}
      resolveFile={resolveFile}
      onRpc={onRpc}
      csp={WEBXDC_CSP}
      onReady={onReady}
      postRef={postRef}
      {...iframeProps}
    />
  );
}
