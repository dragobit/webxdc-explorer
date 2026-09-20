import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  getWebxdcId,
  isWebxdcAppEvent,
  parseWebxdcUpdate,
  WEBXDC_FILE_KIND,
  WEBXDC_MIME,
  WEBXDC_UPDATE_KIND,
} from '@/lib/webxdc';

export interface MyWebxdcApp {
  identifier: string;
  updateCount: number;
  lastUsed: number;
  lastUpdate: NostrEvent;
  /** The app post event, when resolvable from relay-visible data. */
  app?: NostrEvent;
}

/**
 * webxdc sessions the given pubkey has participated in, derived from their
 * own kind-4932 state updates grouped by `i`. App posts are resolved
 * best-effort via the kind-1063 `#m` catalog and NIP-50 `.xdc` search
 * (the `webxdc`/`imeta` tags aren't relay-indexable).
 */
export function useMyWebxdcApps(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<MyWebxdcApp[]>({
    queryKey: ['my-webxdc-apps', pubkey],
    enabled: Boolean(pubkey),
    queryFn: async ({ signal }) => {
      const mine = (
        await nostr.query(
          [{ kinds: [WEBXDC_UPDATE_KIND], authors: [pubkey ?? ''], limit: 500 }],
          { signal },
        )
      ).filter((e) => parseWebxdcUpdate(e));

      const byId = new Map<string, NostrEvent[]>();
      for (const event of mine) {
        const id = parseWebxdcUpdate(event)?.identifier;
        if (!id) continue;
        const list = byId.get(id) ?? [];
        list.push(event);
        byId.set(id, list);
      }
      if (byId.size === 0) return [];

      const catalog = await nostr.query(
        [
          { kinds: [WEBXDC_FILE_KIND], '#m': [WEBXDC_MIME], limit: 200 },
          { kinds: [1], search: '.xdc', limit: 100 },
        ],
        { signal },
      );
      const appById = new Map<string, NostrEvent>();
      for (const event of catalog) {
        if (!isWebxdcAppEvent(event)) continue;
        const id = getWebxdcId(event);
        if (id) appById.set(id, event);
      }

      return [...byId.entries()]
        .map(([identifier, events]) => {
          const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
          return {
            identifier,
            updateCount: events.length,
            lastUsed: sorted[0].created_at,
            lastUpdate: sorted[0],
            app: appById.get(identifier),
          };
        })
        .sort((a, b) => b.lastUsed - a.lastUsed);
    },
  });
}
