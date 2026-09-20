import { useMemo } from 'react';
import { Copy } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/useToast';

interface EventJsonDialogProps {
  event: NostrEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Raw Nostr event inspector — pretty-printed JSON with copy helpers. */
export function EventJsonDialog({ event, open, onOpenChange }: EventJsonDialogProps) {
  const { toast } = useToast();

  const json = useMemo(() => (event ? JSON.stringify(event, null, 2) : ''), [event]);

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: `Copied ${label}` });
  };

  if (!event) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const nevent = nip19.neventEncode({ id: event.id, author: event.pubkey });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            kind {event.kind} · {event.id.slice(0, 16)}…
          </DialogTitle>
          <DialogDescription>
            {new Date(event.created_at * 1000).toLocaleString()} · by{' '}
            <span className="font-mono">{event.pubkey.slice(0, 16)}…</span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => copy(json, 'event JSON')}>
            <Copy className="size-4" /> JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy(event.id, 'event id')}>
            <Copy className="size-4" /> id
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy(nevent, 'nevent')}>
            <Copy className="size-4" /> nevent
          </Button>
        </div>
        <ScrollArea className="h-96 rounded-md border bg-muted/40">
          <pre className="p-4 text-xs leading-relaxed">{json}</pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
