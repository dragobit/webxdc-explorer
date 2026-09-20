import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { parseWebxdcUpdate, WEBXDC_UPDATE_KIND } from '@/lib/webxdc';

/**
 * Search kind-4932 webxdc state-update messages. NIP-50 `search` matches the
 * update payload content on supporting relays; empty query returns recent
 * updates. Newest first.
 */
export function useWebxdcUpdateSearch(query: string) {
  const { nostr } = useNostr();
  const q = query.trim();

  return useQuery<NostrEvent[]>({
    queryKey: ['webxdc-update-search', q],
    queryFn: async ({ signal }) => {
      const filter: NostrFilter = { kinds: [WEBXDC_UPDATE_KIND], limit: 100 };
      if (q) filter.search = q;
      const events = await nostr.query([filter], { signal });
      return events
        .filter((e) => parseWebxdcUpdate(e))
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    },
  });
}
