import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Blocks, Braces } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { EventJsonDialog } from '@/components/webxdc/EventJsonDialog';
import type { ViewMode } from '@/components/webxdc/ViewToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthor } from '@/hooks/useAuthor';
import { getWebxdcId, getWebxdcName, getWebxdcUrl } from '@/lib/webxdc';

interface AppCardProps {
  event: NostrEvent;
  mode: ViewMode;
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export function AppCard({ event, mode }: AppCardProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const author = useAuthor(event.pubkey);

  const identifier = getWebxdcId(event);
  const name = getWebxdcName(event);
  const host = hostOf(getWebxdcUrl(event));
  const authorName = author.data?.metadata?.name ?? `${event.pubkey.slice(0, 8)}…`;
  const snippet = event.content.replace(/\s+/g, ' ').trim().slice(0, 120);

  const meta = (
    <>
      <div className="truncate font-medium">{name}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{authorName}</span>
        <span>·</span>
        <span>{new Date(event.created_at * 1000).toLocaleDateString()}</span>
        <Badge variant="outline">kind {event.kind}</Badge>
        {host && <span>{host}</span>}
        {!identifier && <Badge variant="secondary">no state id</Badge>}
      </div>
      {snippet && <div className="line-clamp-2 text-xs text-muted-foreground">{snippet}</div>}
    </>
  );

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

  const body = identifier ? (
    <Link to={`/app/${encodeURIComponent(identifier)}`} className="block min-w-0 space-y-1 hover:underline">
      {meta}
    </Link>
  ) : (
    <div className="min-w-0 space-y-1">{meta}</div>
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
            {body}
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-3 border-b py-3 last:border-b-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Blocks className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">{body}</div>
          {jsonButton}
        </div>
      )}
      <EventJsonDialog event={event} open={jsonOpen} onOpenChange={setJsonOpen} />
    </>
  );
}
