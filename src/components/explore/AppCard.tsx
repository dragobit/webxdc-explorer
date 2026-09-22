import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Blocks, Braces, Users } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { EventJsonDialog } from '@/components/webxdc/EventJsonDialog';
import type { ViewMode } from '@/components/webxdc/ViewToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useWebxdcIcon } from '@/hooks/useWebxdcIcon';
import type { WebxdcUpdateStats } from '@/hooks/useWebxdcUpdateStats';
import { getWebxdcId, getWebxdcName, getWebxdcUrl } from '@/lib/webxdc';
import { cn } from '@/lib/utils';

interface AppCardProps {
  event: NostrEvent;
  mode: ViewMode;
  stats?: WebxdcUpdateStats;
}

/** App icon: NIP-92 preview image or the .xdc's bundled icon, else a Blocks glyph. */
function AppIcon({ event, className, iconClassName }: { event: NostrEvent; className: string; iconClassName: string }) {
  // Only fetch/extract the icon once the card nears the viewport.
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [failed, setFailed] = useState(false);
  const icon = useWebxdcIcon(event, { enabled: visible });

  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) {
    return (
      <div ref={ref} className={cn('flex shrink-0 items-center justify-center rounded-lg bg-primary/10', className)}>
        <Blocks className={cn('text-primary', iconClassName)} />
      </div>
    );
  }
  if (icon.isLoading) {
    return <Skeleton className={cn('shrink-0 rounded-lg', className)} />;
  }
  if (icon.data && !failed) {
    return (
      <img
        src={icon.data}
        alt=""
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-lg object-cover', className)}
      />
    );
  }
  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-lg bg-primary/10', className)}>
      <Blocks className={cn('text-primary', iconClassName)} />
    </div>
  );
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export function AppCard({ event, mode, stats }: AppCardProps) {
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
        {stats && (
          <>
            <span className="inline-flex items-center gap-0.5">
              <Activity className="size-3" />
              {stats.count} update{stats.count === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Users className="size-3" />
              {stats.participants}
            </span>
          </>
        )}
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
              <AppIcon event={event} className="size-14" iconClassName="size-6" />
              {jsonButton}
            </div>
            {body}
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-3 border-b py-3 last:border-b-0">
          <AppIcon event={event} className="size-9" iconClassName="size-4" />
          <div className="min-w-0 flex-1">{body}</div>
          {jsonButton}
        </div>
      )}
      <EventJsonDialog event={event} open={jsonOpen} onOpenChange={setJsonOpen} />
    </>
  );
}
