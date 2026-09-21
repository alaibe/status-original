import { useEffect, useState } from 'react';

import type { LinkPreview } from '@/core/messaging/link-preview';
import { cachedLinkPreview, loadLinkPreview } from '@/core/messaging/link-preview-cache';

type Loaded = { url: string; preview: LinkPreview | null };

/** `null` while loading or when the site gave nothing. */
export function useLinkPreview(url: string | null): LinkPreview | null {
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const cached = url ? cachedLinkPreview(url) : undefined;
    return url && cached !== undefined ? { url, preview: cached } : null;
  });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    loadLinkPreview(url).then((preview) => {
      if (!cancelled) setLoaded({ url, preview });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return loaded && loaded.url === url ? loaded.preview : null;
}
