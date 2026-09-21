import { router } from 'expo-router';
import { useEffect, useId, useRef } from 'react';
import { create } from 'zustand';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

interface Presented extends Omit<SheetProps, 'visible'> {
  id: string;
}

/** What the `/sheet` route renders. One sheet at a time, the way native form sheets work. */
export const useSheetStore = create<{ current: Presented | null }>(() => ({ current: null }));

function owns(id: string) {
  return useSheetStore.getState().current?.id === id;
}

/**
 * Presents `children` in the native form sheet route while `visible`. Renders
 * nothing where it is declared; the route reads the latest props from the store.
 */
export function Sheet({ visible, ...spec }: SheetProps) {
  const id = useId();
  const presented = useRef(false);

  useEffect(() => {
    if (visible === presented.current) return;
    presented.current = visible;
    if (visible) {
      useSheetStore.setState({ current: { id, ...spec } });
      router.push('/sheet');
    } else if (owns(id)) {
      useSheetStore.setState({ current: null });
      router.back();
    }
    // Only the transition matters here; the effect below keeps the content fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (presented.current && owns(id)) useSheetStore.setState({ current: { id, ...spec } });
  });

  useEffect(
    () => () => {
      if (presented.current && owns(id)) {
        useSheetStore.setState({ current: null });
        router.back();
      }
    },
    [id]
  );

  return null;
}
