import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import {
  getWebxdcId,
  getWebxdcName,
  getWebxdcUrl,
  isWebxdcAppEvent,
  WEBXDC_FILE_KIND,
  WEBXDC_MIME,
} from '@/lib/webxdc';

/**
 * Search webxdc app posts ("本体").
 * Relay-side: the kind-1063 `#m` catalog plus NIP-50 `.xdc` search on kind 1
 * (imeta/webxdc tags aren't relay-indexable). Client-side: results are
 * validated with `isWebxdcAppEvent`; when `q` is present, catalog results are
 * matched against name/content/url/identifier (kind-1 hits already matched
 * relay-side search).
 */
export function useWebxdcAppSearch(query: string) {
  const { nostr } = useNostr();
  const q = query.trim();

  return useQuery<NostrEvent[]>({
    queryKey: ['webxdc-app-search', q],
    queryFn: async ({ signal }) => {
      const filters: NostrFilter[] = [
        { kinds: [WEBXDC_FILE_KIND], '#m': [WEBXDC_MIME], limit: 100 },
        { kinds: [1], search: q || '.xdc', limit: 100 },
      ];
      const events = await nostr.query(filters, { signal });

      const seen = new Set<string>();
      return events
        .filter(isWebxdcAppEvent)
        .filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          if (!q || e.kind !== WEBXDC_FILE_KIND) return true;
          const hay = `${getWebxdcName(e)} ${e.content} ${getWebxdcUrl(e) ?? ''} ${getWebxdcId(e) ?? ''}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        })
        .sort((a, b) => b.created_at - a.created_at);
    },
  });
}
