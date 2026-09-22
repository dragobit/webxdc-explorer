import { useNostr } from '@nostrify/react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { parseWebxdcUpdate, WEBXDC_UPDATE_KIND } from '@/lib/webxdc';

export interface WebxdcUpdateStats {
  /** number of kind-4932 updates */
  count: number;
  /** distinct authors of those updates */
  participants: number;
  /** created_at of the newest update, 0 if none */
  lastUpdate: number;
}

export interface WebxdcUpdateStatsResult {
  /** stats per requested identifier (zero stats when it has none) */
  stats: Map<string, WebxdcUpdateStats>;
  /** every update event the stats were computed from, newest first */
  events: NostrEvent[];
}

/**
 * Kind-4932 update stats grouped by webxdc coordination identifier.
 * Every requested identifier gets an entry (zero stats when it has none).
 */
export function useWebxdcUpdateStats(
  identifiers: string[],
): UseQueryResult<WebxdcUpdateStatsResult> {
  const { nostr } = useNostr();
  const ids = [...new Set(identifiers)].sort();

  return useQuery({
    queryKey: ['webxdc-update-stats', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

      const results = await Promise.all(
        chunks.map((chunk) =>
          nostr.query(
            // limit is shared across the chunk's identifiers, so counts for
            // very chatty apps are a lower bound.
            [{ kinds: [WEBXDC_UPDATE_KIND], '#i': chunk, limit: 1000 }],
            { signal },
          ),
        ),
      );

      const seen = new Set<string>();
      const events: NostrEvent[] = [];
      const stats = new Map<string, WebxdcUpdateStats>(
        ids.map((id) => [id, { count: 0, participants: 0, lastUpdate: 0 }]),
      );
      const authors = new Map<string, Set<string>>();

      for (const event of results.flat()) {
        if (seen.has(event.id)) continue;
        const update = parseWebxdcUpdate(event);
        if (!update || !stats.has(update.identifier)) continue;
        seen.add(event.id);
        events.push(event);
        const s = stats.get(update.identifier)!;
        s.count += 1;
        s.lastUpdate = Math.max(s.lastUpdate, event.created_at);
        let set = authors.get(update.identifier);
        if (!set) authors.set(update.identifier, (set = new Set()));
        set.add(event.pubkey);
        s.participants = set.size;
      }

      events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
      return { stats, events };
    },
  });
}
