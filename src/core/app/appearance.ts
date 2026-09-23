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
  typingIndicators: boolean;
  linkPreviews: boolean;

  hydrate(storage: AccountStorage): Promise<void>;
  clear(): void;
  setTheme(theme: ThemeChoice): Promise<void>;
  setWallpaper(wallpaper: ChatPatternName): Promise<void>;
  setReadReceipts(enabled: boolean): Promise<void>;
  setTypingIndicators(enabled: boolean): Promise<void>;
  setLinkPreviews(enabled: boolean): Promise<void>;
}

type Settings = Pick<
  AppearanceState,
  'theme' | 'wallpaper' | 'readReceipts' | 'typingIndicators' | 'linkPreviews'
>;

const DEFAULTS: Settings = {
  theme: 'system',
  wallpaper: 'doodles',
  readReceipts: false,
  typingIndicators: false,
  linkPreviews: true,
};

let projectedStorage: AccountStorage | null = null;
let hydration = 0;

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  accountId: null,
  ...DEFAULTS,

  async hydrate(storage) {
    const request = ++hydration;
    projectedStorage = storage;
    try {
      const parsed = await storage.get<Partial<Settings>>(KEY);
      if (request !== hydration || projectedStorage !== storage) return;
      set({ accountId: storage.accountId, ...DEFAULTS, ...parsed });
    } catch {}
  },

  clear() {
    hydration += 1;
    projectedStorage = null;
    set({ accountId: null, ...DEFAULTS });
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

  async setTypingIndicators(typingIndicators) {
    set({ typingIndicators });
    await persist(get());
  },

  async setLinkPreviews(linkPreviews) {
    set({ linkPreviews });
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
      typingIndicators: state.typingIndicators,
      linkPreviews: state.linkPreviews,
    } satisfies Settings);
  } catch (error) {
    console.warn('[appearance] could not persist settings', error);
  }
}
