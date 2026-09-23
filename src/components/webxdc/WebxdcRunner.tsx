import { useMemo, useState } from 'react';
import { Maximize2, Minimize2, Play, Square } from 'lucide-react';

import { WebxdcFrame } from '@/components/webxdc/WebxdcFrame';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrWebxdcApi } from '@/hooks/useNostrWebxdcApi';
import { deriveIframeSubdomain } from '@/lib/iframeSubdomain';
import { cn } from '@/lib/utils';

interface WebxdcRunnerProps {
  /** webxdc coordination identifier (`i` tag / imeta `webxdc`). */
  identifier: string;
  xdcUrl: string;
  sha256?: string;
  appName: string;
}

function RunningApp({ identifier, xdcUrl, sha256, appName, fullscreen }: WebxdcRunnerProps & { fullscreen: boolean }) {
  const webxdc = useNostrWebxdcApi(identifier);
  const [error, setError] = useState<string | null>(null);
  const frameId = useMemo(() => deriveIframeSubdomain('webxdc', identifier), [identifier]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-destructive">
        Failed to load app: {error}
      </div>
    );
  }

  return (
    <WebxdcFrame
      id={frameId}
      xdcUrl={xdcUrl}
      sha256={sha256}
      webxdc={webxdc}
      title={appName}
      onLoadError={(err) => setError(err.message)}
      className={cn('w-full border-0 bg-background', fullscreen ? 'h-full' : 'h-[70vh] rounded-lg border')}
    />
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
            Runs sandboxed on an isolated origin with no network access.
            {!user && ' Log in to send updates; viewing works anonymously.'}
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
