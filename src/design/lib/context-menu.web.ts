import type { MenuAnchor } from './context-menu';

export function contextMenu(open: (anchor: MenuAnchor) => void): Record<string, unknown> {
  return {
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      open({ x: event.clientX, y: event.clientY });
    },
  };
}
