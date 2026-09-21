import { router } from 'expo-router';
import { useEffect, useId, useRef } from 'react';
import { create } from 'zustand';

import type { MenuAnchor } from '../lib/context-menu';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Sits before the title, the size of an avatar. */
  leading?: React.ReactNode;
  /** Where a pointer opened it. Desktop places the menu there; a phone ignores it. */
  anchor?: MenuAnchor | null;
  children: React.ReactNode;
}

interface Presented extends Omit<SheetProps, 'visible'> {
  id: string;
}

interface SheetState {
  current: Presented | null;
  afterClose: (() => void) | null;
}

/**
 * How long the native dismissal takes. UIKit refuses to present anything (a
 * browser, another sheet) while it runs, and nothing reports when it is over:
 * the route unmounts at once and a form sheet triggers no appearance callback
 * on the screen beneath.
 */
export const SHEET_DISMISS_MS = 500;

export const useSheetStore = create<SheetState>(() => ({ current: null, afterClose: null }));

/** Closes the sheet and runs `action` once it is off screen. */
export function closeSheetThen(sheet: Pick<SheetProps, 'onClose'>, action: () => void) {
  useSheetStore.setState({ afterClose: action });
  sheet.onClose();
}

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
