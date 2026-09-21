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
export function Sheet({ visible, title, children, onClose, className }: SheetProps) {
  const id = useId();
  const presented = useRef(false);

  useEffect(() => {
    const spec = { id, title, children, onClose, className };
    if (visible && !presented.current) {
      presented.current = true;
      useSheetStore.setState({ current: spec });
      router.push('/sheet');
    } else if (!visible && presented.current) {
      presented.current = false;
      if (owns(id)) {
        useSheetStore.setState({ current: null });
        router.back();
      }
    } else if (visible && owns(id)) {
      useSheetStore.setState({ current: spec });
    }
  }, [visible, id, title, children, onClose, className]);

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
