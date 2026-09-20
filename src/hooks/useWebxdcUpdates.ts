import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { parseWebxdcUpdate, sortWebxdcUpdates, WEBXDC_UPDATE_KIND } from '@/lib/webxdc';

/** All stored kind-4932 state updates for a webxdc identifier, oldest first. */
export function useWebxdcUpdates(identifier: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<NostrEvent[]>({
    queryKey: ['webxdc-updates', identifier],
    enabled: Boolean(identifier),
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{ kinds: [WEBXDC_UPDATE_KIND], '#i': [identifier ?? ''], limit: 500 }],
        { signal },
      );
      return sortWebxdcUpdates(events.filter((e) => parseWebxdcUpdate(e)));
    },
  });
}
