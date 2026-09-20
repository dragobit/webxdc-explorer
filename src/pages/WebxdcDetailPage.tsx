import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Braces, Copy, ExternalLink } from 'lucide-react';

import { EventJsonDialog } from '@/components/webxdc/EventJsonDialog';
import { UpdateRow } from '@/components/app-detail/UpdateRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { useWebxdcAppById } from '@/hooks/useWebxdcAppById';
import { useWebxdcUpdates } from '@/hooks/useWebxdcUpdates';
import { getWebxdcName, getWebxdcUrl } from '@/lib/webxdc';

function httpsUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const WebxdcDetailPage = () => {
  const { i } = useParams<{ i: string }>();
  const { toast } = useToast();
  const [jsonOpen, setJsonOpen] = useState(false);

  const app = useWebxdcAppById(i);
  const updates = useWebxdcUpdates(i);

  const author = useAuthor(app.data?.pubkey);
  const appName = app.data ? getWebxdcName(app.data) : undefined;
  const xdcUrl = httpsUrl(app.data ? getWebxdcUrl(app.data) : undefined);

  const participants = useMemo(
    () => new Set(updates.data?.map((e) => e.pubkey) ?? []).size,
    [updates.data],
  );

  useSeoMeta({
    title: `${appName ?? `webxdc ${i?.slice(0, 12) ?? ''}`} · webxdc explorer`,
    description: 'webxdc app detail and update log.',
  });

  const copyId = async () => {
    if (!i) return;
    await navigator.clipboard.writeText(i);
    toast({ title: 'Copied webxdc id' });
  };

  const loading = app.isLoading || updates.isLoading;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          {loading ? (
            <>
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-96" />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">
                  {appName ?? (i ? `webxdc ${i.slice(0, 12)}…` : 'webxdc app')}
                </h1>
                {app.data && (
                  <Button size="sm" variant="outline" onClick={() => setJsonOpen(true)}>
                    <Braces className="size-4" /> app event JSON
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{i}</code>
                <Button size="icon" variant="ghost" className="size-7" aria-label="Copy webxdc id" onClick={copyId}>
                  <Copy className="size-3.5" />
                </Button>
                {xdcUrl && (
                  <a
                    href={xdcUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5" /> .xdc file
                  </a>
                )}
                {app.data && (
                  <span>
                    posted by {author.data?.metadata?.name ?? `${app.data.pubkey.slice(0, 8)}…`} ·{' '}
                    {new Date(app.data.created_at * 1000).toLocaleString()}
                  </span>
                )}
              </div>
              {!app.isLoading && !app.data && (
                <Badge variant="outline" className="w-fit">
                  app post not found on relays — updates may still appear below
                </Badge>
              )}
            </>
          )}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">
            Update log{' '}
            {updates.data && (
              <span className="text-sm font-normal text-muted-foreground">
                {updates.data.length} update{updates.data.length === 1 ? '' : 's'} by{' '}
                {participants} participant{participants === 1 ? '' : 's'}
              </span>
            )}
          </h2>
        </CardHeader>
        <CardContent>
          {updates.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-16 w-full" />
              ))}
            </div>
          ) : updates.isError ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              Failed to load updates.
            </div>
          ) : updates.data?.length ? (
            <div>
              {updates.data.map((event, idx) => (
                <UpdateRow key={event.id} event={event} serial={idx + 1} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              No state updates yet for this webxdc session.
            </div>
          )}
        </CardContent>
      </Card>

      <EventJsonDialog event={app.data ?? null} open={jsonOpen} onOpenChange={setJsonOpen} />
    </div>
  );
};

export default WebxdcDetailPage;
