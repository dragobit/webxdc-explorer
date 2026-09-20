import { useMemo, useState } from 'react';
import { Braces } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { EventJsonDialog } from '@/components/webxdc/EventJsonDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthor } from '@/hooks/useAuthor';
import { parseWebxdcUpdate } from '@/lib/webxdc';

interface UpdateRowProps {
  event: NostrEvent;
  /** 1-based serial number in created_at order. */
  serial: number;
}

export function UpdateRow({ event, serial }: UpdateRowProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const author = useAuthor(event.pubkey);
  const update = useMemo(() => parseWebxdcUpdate(event), [event]);

  const name = author.data?.metadata?.name ?? `${event.pubkey.slice(0, 8)}…`;

  return (
    <div className="flex gap-3 border-b py-3 last:border-b-0">
      <div className="w-10 shrink-0 pt-0.5 text-right font-mono text-xs text-muted-foreground">
        #{serial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground">
            {new Date(event.created_at * 1000).toLocaleString()}
          </span>
          {update?.info && <Badge variant="secondary">{update.info}</Badge>}
          {update?.summary && <Badge variant="outline">{update.summary}</Badge>}
          {update?.document && <Badge variant="outline">doc: {update.document}</Badge>}
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-7"
            aria-label="View raw event JSON"
            onClick={() => setJsonOpen(true)}
          >
            <Braces className="size-4" />
          </Button>
        </div>
        {event.content && (
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted/50 p-2 text-xs leading-relaxed">
            {update?.payload !== undefined
              ? JSON.stringify(update.payload, null, 2)
              : event.content}
          </pre>
        )}
      </div>
      <EventJsonDialog event={event} open={jsonOpen} onOpenChange={setJsonOpen} />
    </div>
  );
}
