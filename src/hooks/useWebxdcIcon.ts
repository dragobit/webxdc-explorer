import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { extractWebxdcIcon, getWebxdcPreviewImage } from '@/lib/webxdcIcon';
import { getWebxdcUrl } from '@/lib/webxdc';

/**
 * Icon URL for a webxdc app event: the NIP-92 preview image when present,
 * otherwise `icon.png`/`icon.jpg` extracted from inside the .xdc zip.
 * Extracted icons are object URLs; they intentionally live as long as the
 * query cache entry rather than being revoked.
 */
export function useWebxdcIcon(event: NostrEvent | undefined) {
  return useQuery<string | null>({
    queryKey: ['webxdc-icon', event?.id],
    enabled: Boolean(event),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!event) return null;
      const preview = getWebxdcPreviewImage(event);
      if (preview) return preview;
      const url = getWebxdcUrl(event);
      if (url) {
        try {
          if (new URL(url).protocol !== 'https:') return null;
        } catch {
          return null;
        }
        const blob = await extractWebxdcIcon(url, signal);
        if (blob) return URL.createObjectURL(blob);
      }
      return null;
    },
  });
}
