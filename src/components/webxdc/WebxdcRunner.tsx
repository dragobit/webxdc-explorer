import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Play, Square } from 'lucide-react';

import { ImportFilesPrompt } from '@/components/webxdc/ImportFilesPrompt';
import { SendToChatDialog } from '@/components/webxdc/SendToChatDialog';
import { WebxdcFrame } from '@/components/webxdc/WebxdcFrame';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrWebxdcApi } from '@/hooks/useNostrWebxdcApi';
import type { ImportFilesFilter, SendOptions } from '@/hooks/useNostrWebxdcApi';
import { deriveIframeSubdomain } from '@/lib/iframeSubdomain';
import { cn } from '@/lib/utils';

interface WebxdcRunnerProps {
  /** webxdc coordination identifier (`i` tag / imeta `webxdc`). */
  identifier: string;
  xdcUrl: string;
  sha256?: string;
  appName: string;
}

interface ChatRequest {
  message: SendOptions;
  resolve: () => void;
  reject: (err: Error) => void;
}

interface ImportRequest {
  filter: ImportFilesFilter;
  resolve: (files: File[]) => void;
}

function RunningApp({ identifier, xdcUrl, sha256, appName, fullscreen }: WebxdcRunnerProps & { fullscreen: boolean }) {
  const { api, setSendToChatHandler, setImportFilesHandler } = useNostrWebxdcApi(identifier);
  const [error, setError] = useState<string | null>(null);
  const frameId = useMemo(() => deriveIframeSubdomain('webxdc', identifier), [identifier]);

  const [chatReq, setChatReq] = useState<ChatRequest | null>(null);
  const [importReq, setImportReq] = useState<ImportRequest | null>(null);
  const chatReqRef = useRef<ChatRequest | null>(null);
  const importReqRef = useRef<ImportRequest | null>(null);

  // The iframe's sendToChat / importFiles calls are user-mediated: park each
  // RPC in a ref-backed pending request that the dialog / prompt settles.
  useEffect(() => {
    setSendToChatHandler(
      (message) =>
        new Promise<void>((resolve, reject) => {
          if (chatReqRef.current) {
            reject(new Error('sendToChat already in progress'));
            return;
          }
          const req: ChatRequest = { message, resolve, reject };
          chatReqRef.current = req;
          setChatReq(req);
        }),
    );
    setImportFilesHandler(
      (filter) =>
        new Promise<File[]>((resolve) => {
          if (importReqRef.current) {
            resolve([]);
            return;
          }
          const req: ImportRequest = { filter, resolve };
          importReqRef.current = req;
          setImportReq(req);
        }),
    );
    return () => {
      setSendToChatHandler(null);
      setImportFilesHandler(null);
      // Settle any dangling request so the iframe-side promise never hangs in
      // parent state after the app is stopped.
      chatReqRef.current?.reject(new Error('app stopped'));
      chatReqRef.current = null;
      importReqRef.current?.resolve([]);
      importReqRef.current = null;
    };
  }, [setSendToChatHandler, setImportFilesHandler]);

  const settleChat = (posted: boolean, reason?: string) => {
    const req = chatReqRef.current;
    chatReqRef.current = null;
    setChatReq(null);
    if (!req) return;
    if (posted) req.resolve();
    else req.reject(new Error(reason ?? 'sendToChat cancelled'));
  };

  const settleImport = (files: File[]) => {
    const req = importReqRef.current;
    importReqRef.current = null;
    setImportReq(null);
    req?.resolve(files);
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-destructive">
        Failed to load app: {error}
      </div>
    );
  }

  return (
    <div className={cn('relative', fullscreen && 'h-full')}>
      <ImportFilesPrompt appName={appName} request={importReq?.filter ?? null} onFiles={settleImport} />
      <WebxdcFrame
        key={xdcUrl}
        id={frameId}
        xdcUrl={xdcUrl}
        sha256={sha256}
        webxdc={api}
        title={appName}
        onLoadError={(err) => setError(err.message)}
        className={cn('w-full border-0 bg-background', fullscreen ? 'h-full' : 'h-[70vh] rounded-lg border')}
      />
      <SendToChatDialog
        appName={appName}
        xdcUrl={xdcUrl}
        request={chatReq?.message ?? null}
        onDone={settleChat}
      />
    </div>
  );
}

/**
 * "Run" card for the app detail page. Mounts the sandboxed webxdc runtime on
 * demand; state updates are read from / published to relays as kind 4932.
 */
export function WebxdcRunner(props: WebxdcRunnerProps) {
  const { user } = useCurrentUser();
  const [running, setRunning] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Run app</h2>
          <p className="text-sm text-muted-foreground">
            Runs sandboxed on an isolated origin; the app&apos;s own requests are blocked from reaching the network.
            {!user && ' Log in to send updates or share; viewing works anonymously.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <Button size="sm" variant="outline" onClick={() => setFullscreen((f) => !f)}>
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </Button>
          )}
          <Button size="sm" variant={running ? 'outline' : 'default'} onClick={() => { setRunning((r) => !r); setFullscreen(false); }}>
            {running ? <Square className="size-4" /> : <Play className="size-4" />}
            {running ? 'Stop' : 'Run'}
          </Button>
        </div>
      </CardHeader>
      {running && (
        <CardContent
          className={cn(fullscreen && 'fixed inset-0 z-50 flex flex-col bg-background p-0')}
        >
          {fullscreen && (
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="truncate text-sm font-medium">{props.appName}</span>
              <Button size="sm" variant="ghost" onClick={() => setFullscreen(false)}>
                <Minimize2 className="size-4" /> Exit fullscreen
              </Button>
            </div>
          )}
          <div className={cn(fullscreen && 'min-h-0 flex-1')}>
            <RunningApp {...props} fullscreen={fullscreen} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
