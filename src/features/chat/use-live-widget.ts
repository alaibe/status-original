import { useEffect, useState } from 'react';

import type { WidgetContent } from '@/core/messaging/types';
import { usePluginHost } from '@/core/plugins/host';
import { useLiveViews } from '@/core/plugins/live';
import type { Widget } from '@/design/widgets';

export function useLiveWidget(content: WidgetContent): Widget {
  const { registry, enabledIds } = usePluginHost();
  const live = content.live;
  const version = useLiveViews((s) => (live ? (s.versions[live.pluginId] ?? 0) : 0));
  const [fresh, setFresh] = useState<Widget | null>(null);

  useEffect(() => {
    const view = live && registry.view(live.pluginId, live.view);
    if (!view) return;

    let stale = false;
    view(live.args)
      .then((built) => {
        if (!stale) setFresh(built.widget);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [registry, enabledIds, live, version]);

  return fresh ?? content.widget;
}
