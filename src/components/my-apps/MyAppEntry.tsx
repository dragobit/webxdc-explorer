import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Blocks, Braces } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import type { MyWebxdcApp } from '@/hooks/useMyWebxdcApps';
import { EventJsonDialog } from '@/components/webxdc/EventJsonDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthor } from '@/hooks/useAuthor';
import { getWebxdcName } from '@/lib/webxdc';
import { cn } from '@/lib/utils';

interface MyAppEntryProps {
  app: MyWebxdcApp;
  mode: 'grid' | 'list';
}

function Meta({ app }: { app: MyWebxdcApp }) {
  const author = useAuthor(app.app?.pubkey);
  const name = app.app ? getWebxdcName(app.app) : `webxdc ${app.identifier.slice(0, 8)}…`;
  return (
    <>
      <div className="truncate font-medium">{name}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="secondary">{app.updateCount} update{app.updateCount === 1 ? '' : 's'}</Badge>
        <span>last used {new Date(app.lastUsed * 1000).toLocaleString()}</span>
        {app.app ? (
          <span>by {author.data?.metadata?.name ?? `${app.app.pubkey.slice(0, 8)}…`}</span>
        ) : (
          <span className="italic">app post not found on relays</span>
        )}
      </div>
    </>
  );
}

export function MyAppEntry({ app, mode }: MyAppEntryProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const jsonEvent: NostrEvent = app.app ?? app.lastUpdate;

  const jsonButton = (
    <Button
      size="icon"
      variant="ghost"
      className="size-7 shrink-0"
      aria-label="View raw event JSON"
      onClick={(e) => {
        e.preventDefault();
        setJsonOpen(true);
      }}
    >
      <Braces className="size-4" />
    </Button>
  );

  return (
    <>
      {mode === 'grid' ? (
        <Card className="transition-shadow hover:shadow-md">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Blocks className="size-5 text-primary" />
              </div>
              {jsonButton}
            </div>
            <Link to={`/app/${encodeURIComponent(app.identifier)}`} className="block min-w-0 hover:underline">
              <Meta app={app} />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className={cn('flex items-center gap-3 border-b py-3 last:border-b-0')}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Blocks className="size-4 text-primary" />
          </div>
          <Link to={`/app/${encodeURIComponent(app.identifier)}`} className="min-w-0 flex-1 hover:underline">
            <Meta app={app} />
          </Link>
          {jsonButton}
        </div>
      )}
      <EventJsonDialog event={jsonEvent} open={jsonOpen} onOpenChange={setJsonOpen} />
    </>
  );
}
