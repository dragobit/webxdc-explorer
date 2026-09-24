import { useEffect, useMemo, useState } from 'react';
import type { Webxdc as WebxdcAPI } from '@webxdc/types/webxdc';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useUploadFile } from '@/hooks/useUploadFile';
import { SEND_FILE_MAX_BYTES, xdcFileToFile } from '@/lib/xdcFile';

type SendOptions = Parameters<WebxdcAPI<unknown>['sendToChat']>[0];

interface SendToChatDialogProps {
  /** App display name, shown in the title. */
  appName: string;
  /** https URL of the app's `.xdc`, linked via an `r` tag. */
  xdcUrl: string;
  /** The message the app asked to send; `null` keeps the dialog closed. */
  request: SendOptions | null;
  /** Called once the request is settled: `true` = posted, `false` = cancelled/failed. */
  onDone: (posted: boolean, reason?: string) => void;
}

function downloadFile(file: File) {
  const url = globalThis.URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => globalThis.URL.revokeObjectURL(url), 30_000);
}

/**
 * User-mediated `webxdc.sendToChat`: shows the app's message for confirmation,
 * uploads any attachment to Blossom, and posts it as a kind 1 note.
 */
export function SendToChatDialog({ appName, request, xdcUrl, onDone }: SendToChatDialogProps) {
  const { toast } = useToast();
  const { mutateAsync: uploadFile } = useUploadFile();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [prevRequest, setPrevRequest] = useState<SendOptions | null>(null);

  const file = useMemo(() => {
    if (!request?.file) return null;
    try {
      const f = xdcFileToFile(request.file);
      return f.size > SEND_FILE_MAX_BYTES ? null : f;
    } catch {
      return null;
    }
  }, [request]);

  const previewUrl = useMemo(
    () => (file?.type.startsWith('image/') ? globalThis.URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(
    () => () => {
      if (previewUrl) globalThis.URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  // Reset the editable draft whenever a new request arrives (adjust-during-render).
  if (request !== prevRequest) {
    setPrevRequest(request);
    setText(request?.text ?? '');
    setBusy(false);
  }

  const finish = (posted: boolean, reason?: string) => {
    setBusy(false);
    onDone(posted, reason);
  };

  const post = async () => {
    setBusy(true);
    try {
      const tags: string[][] = [
        ['r', xdcUrl],
        ['t', 'webxdc'],
      ];
      let content = text;
      if (file) {
        const uploadTags = await uploadFile(file);
        const url = uploadTags[0]?.[1];
        if (!url) throw new Error('File upload returned no URL');
        content = content ? `${content}\n\n${url}` : url;
        tags.push(['imeta', ...uploadTags.map(([n, v]) => `${n} ${v}`)]);
      }
      await publishEvent({ kind: 1, content, tags });
      toast({ title: 'Posted note' });
      finish(true);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Failed to post',
        description: reason,
        variant: 'destructive',
      });
      finish(false, `sendToChat failed: ${reason}`);
    }
  };

  const open = request !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) finish(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share from {appName}</DialogTitle>
          <DialogDescription>
            The app wants to post this message as a Nostr note.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message"
          className="min-h-24"
        />
        {file && (
          <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
            {previewUrl && (
              <img
                src={previewUrl}
                alt=""
                className="size-10 rounded object-cover"
              />
            )}
            <div className="min-w-0">
              <div className="truncate font-medium">{file.name}</div>
              <div className="text-xs text-muted-foreground">
                {file.type || 'application/octet-stream'} · {file.size} bytes
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          {file && (
            <Button variant="outline" disabled={busy} onClick={() => { downloadFile(file); finish(false); }}>
              Download file
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button disabled={busy || (!text && !file)} onClick={() => void post()}>
            {busy ? 'Posting…' : 'Post note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
