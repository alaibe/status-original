import { create } from 'zustand';

import type { AccountStorage } from '@/storage/account';
import type { ChatPatternName } from '@/design';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'appearance';

interface AppearanceState {
  accountId: string | null;
  theme: ThemeChoice;
  wallpaper: ChatPatternName;
  readReceipts: boolean;

  hydrate(storage: AccountStorage): Promise<void>;
  clear(): void;
  setTheme(theme: ThemeChoice): Promise<void>;
  setWallpaper(wallpaper: ChatPatternName): Promise<void>;
  setReadReceipts(enabled: boolean): Promise<void>;
}

let projectedStorage: AccountStorage | null = null;
let hydration = 0;

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  accountId: null,
  theme: 'system',
  wallpaper: 'doodles',
  readReceipts: false,

  async hydrate(storage) {
    const request = ++hydration;
    projectedStorage = storage;
    try {
      const parsed = await storage.get<Partial<AppearanceState>>(KEY);
      if (request !== hydration || projectedStorage !== storage) return;
      if (!parsed) {
        set({ accountId: storage.accountId, theme: 'system', wallpaper: 'doodles', readReceipts: false });
        return;
      }
      set({
        accountId: storage.accountId,
        theme: parsed.theme ?? 'system',
        wallpaper: parsed.wallpaper ?? 'doodles',
        readReceipts: parsed.readReceipts ?? false,
      });
    } catch {
    }
  },

  clear() {
    hydration += 1;
    projectedStorage = null;
    set({ accountId: null, theme: 'system', wallpaper: 'doodles', readReceipts: false });
  },

  async setTheme(theme) {
    set({ theme });
    await persist(get());
  },

  async setWallpaper(wallpaper) {
    set({ wallpaper });
    await persist(get());
  },

  async setReadReceipts(readReceipts) {
    set({ readReceipts });
    await persist(get());
  },
}));

async function persist(state: AppearanceState): Promise<void> {
  const storage = projectedStorage;
  if (!state.accountId || storage?.accountId !== state.accountId) return;
  try {
    await storage.set(KEY, {
      theme: state.theme,
      wallpaper: state.wallpaper,
      readReceipts: state.readReceipts,
    });
  } catch (error) {
    console.warn('[appearance] could not persist settings', error);
  }
}
