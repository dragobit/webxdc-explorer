import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { getWebxdcId, isWebxdcAppEvent, WEBXDC_FILE_KIND, WEBXDC_MIME } from '@/lib/webxdc';

/**
 * Resolve a webxdc coordination identifier (`i`) to its app post event.
 * Best-effort: the `webxdc`/`imeta` tags aren't relay-indexable, so we scan
 * the kind-1063 `#m` catalog plus NIP-50 `.xdc` search results and match
 * client-side.
 */
export function useWebxdcAppById(identifier: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<NostrEvent | undefined>({
    queryKey: ['webxdc-app', identifier],
    enabled: Boolean(identifier),
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [
          { kinds: [WEBXDC_FILE_KIND], '#m': [WEBXDC_MIME], limit: 200 },
          { kinds: [1], search: '.xdc', limit: 100 },
          { kinds: [1, WEBXDC_FILE_KIND], search: identifier, limit: 20 },
        ],
        { signal },
      );
      return events.find((e) => isWebxdcAppEvent(e) && getWebxdcId(e) === identifier);
    },
  });
}
