import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import type {
  Webxdc as WebxdcAPI,
  SendingStatusUpdate,
  ReceivedStatusUpdate,
  RealtimeListener,
} from '@webxdc/types/webxdc';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useWebxdcUpdates } from '@/hooks/useWebxdcUpdates';
import { base64ToBytes, bytesToBase64 } from '@/lib/sandbox';
import {
  parseWebxdcUpdate,
  sortWebxdcUpdates,
  WEBXDC_REALTIME_KIND,
  WEBXDC_UPDATE_KIND,
} from '@/lib/webxdc';

type UpdateListener = (update: ReceivedStatusUpdate<unknown>) => void;

interface UpdateEntry {
  id: string;
  update: ReceivedStatusUpdate<unknown>;
}

/**
 * NIP-DC backed `window.webxdc` implementation for one coordination
 * identifier: kind 4932 events are the durable state plane, kind 20932
 * ephemeral events are the realtime plane. Both are public.
 */
export function useNostrWebxdcApi(identifier: string): WebxdcAPI<unknown> {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user, metadata } = useCurrentUser();
  const { mutate: publish } = useNostrPublish();
  const updatesQuery = useWebxdcUpdates(identifier);
  const queryKey = useMemo(() => ['webxdc-updates', identifier], [identifier]);

  const selfPubkey = user?.pubkey;
  const selfAddr = useMemo(() => (selfPubkey ? nip19.npubEncode(selfPubkey) : 'anonymous'), [selfPubkey]);
  const selfName = useMemo(
    () => metadata?.display_name || metadata?.name || (selfPubkey ? `${selfPubkey.slice(0, 8)}…` : 'Anonymous'),
    [metadata, selfPubkey],
  );

  // Serials are positional in the sorted list, so a late-arriving older event
  // shifts them; delivery is therefore tracked by event id, not by serial.
  const entries = useMemo((): UpdateEntry[] => {
    const events = updatesQuery.data ?? [];
    return events.map((event, index) => {
      const parsed = parseWebxdcUpdate(event);
      return {
        id: event.id,
        update: {
          payload: parsed?.payload ?? event.content,
          serial: index + 1,
          max_serial: events.length,
          ...(parsed?.info && { info: parsed.info }),
          ...(parsed?.document && { document: parsed.document }),
          ...(parsed?.summary && { summary: parsed.summary }),
        },
      };
    });
  }, [updatesQuery.data]);

  const updates = useMemo(() => entries.map((e) => e.update), [entries]);

  const listenerRef = useRef<UpdateListener | null>(null);
  const deliveredRef = useRef(new Set<string>());

  useEffect(() => {
    const listener = listenerRef.current;
    if (!listener) return;
    for (const { id, update } of entries) {
      if (deliveredRef.current.has(id)) continue;
      deliveredRef.current.add(id);
      listener(update);
    }
  }, [entries]);

  // Live subscriptions while the app is open: state updates are merged into
  // the query cache; realtime frames go straight to listeners.
  const realtimeListeners = useRef(new Set<(data: Uint8Array) => void>());

  useEffect(() => {
    const controller = new AbortController();
    const since = Math.floor(Date.now() / 1000) - 5;

    (async () => {
      try {
        for await (const msg of nostr.req(
          [{ kinds: [WEBXDC_UPDATE_KIND, WEBXDC_REALTIME_KIND], '#i': [identifier], since }],
          { signal: controller.signal },
        )) {
          if (msg[0] === 'CLOSED') break;
          if (msg[0] !== 'EVENT') continue;
          const event = msg[2];
          if (event.kind === WEBXDC_REALTIME_KIND) {
            if (event.pubkey === selfPubkey) continue;
            try {
              const bytes = base64ToBytes(event.content);
              for (const cb of realtimeListeners.current) cb(bytes);
            } catch {
              // malformed frame
            }
          } else if (parseWebxdcUpdate(event)) {
            queryClient.setQueryData<NostrEvent[]>(queryKey, (old) => {
              if (old?.some((e) => e.id === event.id)) return old;
              return sortWebxdcUpdates([...(old ?? []), event]);
            });
          }
        }
      } catch {
        // subscription aborted
      }
    })();

    return () => controller.abort();
  }, [nostr, identifier, selfPubkey, queryClient, queryKey]);

  const sendUpdate = useCallback(
    (update: SendingStatusUpdate<unknown>, _description: '') => {
      const tags: string[][] = [
        ['i', identifier],
        ['alt', 'Webxdc update'],
      ];
      if (update.info) tags.push(['info', update.info]);
      if (update.document) tags.push(['document', update.document]);
      if (update.summary) tags.push(['summary', update.summary]);
      publish(
        { kind: WEBXDC_UPDATE_KIND, content: JSON.stringify(update.payload), tags },
        {
          onSuccess: (event) => {
            queryClient.setQueryData<NostrEvent[]>(queryKey, (old) => {
              if (old?.some((e) => e.id === event.id)) return old;
              return sortWebxdcUpdates([...(old ?? []), event]);
            });
          },
        },
      );
    },
    [identifier, publish, queryClient, queryKey],
  );

  const setUpdateListener = useCallback(
    async (cb: UpdateListener, serial?: number): Promise<void> => {
      listenerRef.current = cb;
      const delivered = new Set<string>();
      for (const { id, update } of entries) {
        delivered.add(id);
        if (update.serial > (serial ?? 0)) cb(update);
      }
      deliveredRef.current = delivered;
    },
    [entries],
  );

  const getAllUpdates = useCallback(async () => updates, [updates]);

  const realtimeActiveRef = useRef(false);
  const joinRealtimeChannel = useCallback((): RealtimeListener => {
    if (realtimeActiveRef.current) {
      throw new Error('Already joined a realtime channel. Call leave() first.');
    }
    realtimeActiveRef.current = true;
    let listener: ((data: Uint8Array) => void) | null = null;
    const forward = (data: Uint8Array) => listener?.(data);
    realtimeListeners.current.add(forward);

    return {
      setListener(cb) {
        listener = cb;
      },
      send(data) {
        if (!realtimeActiveRef.current) return;
        if (data.length > 128_000) throw new Error('Realtime payload exceeds 128,000 byte limit');
        publish({ kind: WEBXDC_REALTIME_KIND, content: bytesToBase64(data), tags: [['i', identifier]] });
      },
      leave() {
        realtimeActiveRef.current = false;
        listener = null;
        realtimeListeners.current.delete(forward);
      },
    };
  }, [identifier, publish]);

  const sendToChat = useCallback(async (): Promise<void> => {
    throw new Error('sendToChat is not supported');
  }, []);
  const importFiles = useCallback(async (): Promise<File[]> => [], []);

  return useMemo<WebxdcAPI<unknown>>(
    () => ({
      selfAddr,
      selfName,
      sendUpdateInterval: 1000,
      sendUpdateMaxSize: 65536,
      sendUpdate,
      setUpdateListener,
      getAllUpdates,
      sendToChat,
      importFiles,
      joinRealtimeChannel,
    }),
    [selfAddr, selfName, sendUpdate, setUpdateListener, getAllUpdates, sendToChat, importFiles, joinRealtimeChannel],
  );
}
