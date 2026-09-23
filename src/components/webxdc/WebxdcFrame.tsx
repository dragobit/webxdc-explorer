import { useCallback, useEffect, useRef, type IframeHTMLAttributes } from 'react';
import { unzipSync } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Webxdc as WebxdcAPI, ReceivedStatusUpdate, RealtimeListener } from '@webxdc/types/webxdc';

import { SandboxFrame } from '@/components/webxdc/SandboxFrame';
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

/** Ceiling on a `.xdc` bundle. */
const MAX_XDC_BYTES = 100 * 1024 * 1024;

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
  const unzipped = unzipSync(bytes);
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
function generateWebxdcBridge(api: WebxdcAPI<unknown>): string {
  return `(function(){
  var nextId = 1;
  var pending = {};
  var updateListener = null;
  var realtimeDataListener = null;
  var realtimeChannelId = null;

  function send(msg) { window.parent.postMessage(msg, "*"); }

  function sendRequest(method, params) {
    var id = nextId++;
    return new Promise(function(resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      send({ jsonrpc: "2.0", id: id, method: method, params: params });
    });
  }

  window.addEventListener("message", function(event) {
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
      }
    }
  });

  window.webxdc = {
    selfAddr: ${JSON.stringify(api.selfAddr)},
    selfName: ${JSON.stringify(api.selfName)},
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
  update?: Parameters<WebxdcAPI<unknown>['sendUpdate']>[0];
  serial?: number;
  message?: string;
  channelId?: string;
  data?: number[];
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

  useEffect(() => {
    const channels = realtimeChannels.current;
    return () => {
      for (const ch of channels.values()) ch.leave();
      channels.clear();
    };
  }, []);

  const onReady = useCallback(() => {
    loadPromiseRef.current ??= (async () => {
      try {
        const bytes = await fetchXdc(xdcUrl, expectedSha256);
        fileMapRef.current = unzipXdc(bytes);
        bridgeScriptRef.current = generateWebxdcBridge(webxdcRef.current);
      } catch (err) {
        console.error('[WebxdcFrame] Failed to initialise:', err);
        onLoadErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
        loadPromiseRef.current = null;
      }
    })();
    return loadPromiseRef.current;
  }, [xdcUrl, expectedSha256]);

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
          if (params.update) api.sendUpdate(params.update, '');
          return null;

        case 'webxdc.setUpdateListener':
          await api.setUpdateListener((update: ReceivedStatusUpdate<unknown>) => {
            post({ jsonrpc: '2.0', method: 'webxdc.update', params: { update } });
          }, params.serial ?? 0);
          return null;

        case 'webxdc.getAllUpdates':
          return await api.getAllUpdates();

        case 'webxdc.sendToChat':
          throw new Error('sendToChat is not supported');

        case 'webxdc.importFiles':
          return [];

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
          if (ch && params.data) ch.send(new Uint8Array(params.data));
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
      {...iframeProps}
    />
  );
}
