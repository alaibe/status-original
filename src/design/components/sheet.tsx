import { router } from 'expo-router';
import { useEffect, useId, useRef } from 'react';
import { create } from 'zustand';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Sits before the title, the size of an avatar. */
  leading?: React.ReactNode;
  children: React.ReactNode;
}

interface Presented extends Omit<SheetProps, 'visible'> {
  id: string;
}

export const useSheetStore = create<{ current: Presented | null }>(() => ({ current: null }));

function owns(id: string) {
  return useSheetStore.getState().current?.id === id;
}

export function Sheet({ visible, title, subtitle, leading, children, onClose }: SheetProps) {
  const id = useId();
  const presented = useRef(false);

  useEffect(() => {
    const spec = { id, title, subtitle, leading, children, onClose };
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
  }, [visible, id, title, subtitle, leading, children, onClose]);

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
