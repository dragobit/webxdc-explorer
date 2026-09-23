import { useCallback, useEffect, useMemo, useRef, type IframeHTMLAttributes } from 'react';

import { SANDBOX_DOMAIN } from '@/lib/iframeSubdomain';
import { bytesToBase64, utf8ToBase64 } from '@/lib/sandbox';
import type { FileResponse, SerialisedRequest } from '@/lib/sandbox';

export interface SandboxFrameProps
  extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'id' | 'sandbox'> {
  /** HMAC-derived subdomain label. */
  id: string;
  /** Resolve a pathname to file content; `null` means 404. */
  resolveFile: (pathname: string) => Promise<FileResponse | null>;
  /** Handle non-fetch JSON-RPC methods (e.g. `webxdc.*`). */
  onRpc?: (
    method: string,
    params: unknown,
    post: (msg: Record<string, unknown>) => void,
  ) => Promise<unknown>;
  /** Content-Security-Policy header added to every response. */
  csp?: string;
  /** Awaited before `init` is sent back on `ready`. */
  onReady?: () => void | Promise<void>;
}

const SANDBOX_ALLOW = [
  'autoplay',
  'camera',
  'clipboard-write',
  'fullscreen',
  'gamepad',
  'microphone',
  'pointer-lock',
  'screen-wake-lock',
].join('; ');

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
}

/**
 * Sandboxed content frame on a unique `<id>.<SANDBOX_DOMAIN>` origin,
 * implementing the iframe.diy handshake + fetch proxy protocol.
 */
export function SandboxFrame({ id, resolveFile, onRpc, csp, onReady, ...iframeProps }: SandboxFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const origin = useMemo(() => `https://${id}.${SANDBOX_DOMAIN}`, [id]);

  const resolveFileRef = useRef(resolveFile);
  const onRpcRef = useRef(onRpc);
  const cspRef = useRef(csp);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    resolveFileRef.current = resolveFile;
    onRpcRef.current = onRpc;
    cspRef.current = csp;
    onReadyRef.current = onReady;
  }, [resolveFile, onRpc, csp, onReady]);

  const post = useCallback(
    (msg: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(msg, origin);
    },
    [origin],
  );

  useEffect(() => {
    async function handleFetch(id: string | number, params: { request?: SerialisedRequest } | undefined) {
      const reqUrl = params?.request?.url;
      if (!reqUrl) {
        post({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Invalid request' } });
        return;
      }
      let pathname: string;
      try {
        const url = new URL(reqUrl);
        if (url.origin !== origin) {
          post({ jsonrpc: '2.0', id, error: { code: -32003, message: 'Origin mismatch' } });
          return;
        }
        pathname = url.pathname;
      } catch {
        post({ jsonrpc: '2.0', id, error: { code: -32003, message: 'Invalid URL' } });
        return;
      }

      const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
      if (cspRef.current) headers['Content-Security-Policy'] = cspRef.current;

      try {
        const file = await resolveFileRef.current(pathname);
        if (!file) {
          post({
            jsonrpc: '2.0',
            id,
            result: {
              status: 404,
              statusText: 'Not Found',
              headers: { ...headers, 'Content-Type': 'text/plain' },
              body: utf8ToBase64('Not Found'),
            },
          });
          return;
        }
        post({
          jsonrpc: '2.0',
          id,
          result: {
            status: file.status,
            statusText: 'OK',
            headers: { ...headers, 'Content-Type': file.contentType },
            body: bytesToBase64(file.body),
          },
        });
      } catch (err) {
        post({ jsonrpc: '2.0', id, error: { code: -32002, message: String(err) } });
      }
    }

    async function handleRpc(id: string | number, method: string, params: unknown) {
      try {
        const result = await onRpcRef.current?.(method, params, post);
        post({ jsonrpc: '2.0', id, result: result ?? null });
      } catch (err) {
        post({ jsonrpc: '2.0', id, error: { code: -1, message: String(err) } });
      }
    }

    async function handleReady() {
      try {
        await onReadyRef.current?.();
      } catch (err) {
        console.error('[SandboxFrame] onReady failed:', err);
      }
      post({ jsonrpc: '2.0', method: 'init', params: { version: 1 } });
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data as JsonRpcMessage | null;
      if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;

      if (msg.method === 'ready' && msg.id === undefined) {
        void handleReady();
        return;
      }
      if (msg.id !== undefined && msg.method) {
        if (msg.method === 'fetch') {
          void handleFetch(msg.id, msg.params as { request?: SerialisedRequest } | undefined);
        } else if (onRpcRef.current) {
          void handleRpc(msg.id, msg.method, msg.params ?? {});
        }
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, post]);

  return (
    <iframe
      ref={iframeRef}
      src={`${origin}/`}
      allow={SANDBOX_ALLOW}
      // allow-same-origin is safe because the frame lives on a distinct
      // HMAC-derived subdomain. allow-top-navigation and allow-popups are
      // deliberately omitted so the app cannot open an unsandboxed window.
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock"
      {...iframeProps}
    />
  );
}
