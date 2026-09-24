import { useAppearanceStore, type ThemeChoice } from '@/core/app/appearance';
import { writeCredential, type CredentialId } from '@/core/identity/credentials';
import { useIdentityStore } from '@/core/identity/identity-store';
import { CHAT_PATTERNS, type ChatPatternName } from '@/design/components/chat-pattern-tile';

import { whenAccountReady, type CliHandler } from '../context';
import { CliError } from '../errors';
import { readText } from './input';

const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];
const WALLPAPERS = Object.keys(CHAT_PATTERNS) as ChatPatternName[];
const CREDENTIALS: CredentialId[] = ['gifs', 'trades'];

function onOff(value: string): boolean {
  if (['on', 'true', 'yes', '1'].includes(value)) return true;
  if (['off', 'false', 'no', '0'].includes(value)) return false;
  throw new CliError(`Use on or off, not "${value}".`, 'usage');
}

function oneOf<T extends string>(value: string, choices: readonly T[], what: string): T {
  if ((choices as readonly string[]).includes(value)) return value as T;
  throw new CliError(`${what} is one of: ${choices.join(', ')}.`, 'usage');
}

const SETTERS: Record<string, (value: string) => Promise<void>> = {
  theme: (v) => useAppearanceStore.getState().setTheme(oneOf(v, THEMES, 'theme')),
  wallpaper: (v) => useAppearanceStore.getState().setWallpaper(oneOf(v, WALLPAPERS, 'wallpaper')),
  'read-receipts': (v) => useAppearanceStore.getState().setReadReceipts(onOff(v)),
  'typing-indicators': (v) => useAppearanceStore.getState().setTypingIndicators(onOff(v)),
  'link-previews': (v) => useAppearanceStore.getState().setLinkPreviews(onOff(v)),
};

function current() {
  const s = useAppearanceStore.getState();
  return {
    theme: s.theme,
    wallpaper: s.wallpaper,
    'read-receipts': s.readReceipts,
    'typing-indicators': s.typingIndicators,
    'link-previews': s.linkPreviews,
  };
}

export const settingsHandlers = {
  async settings() {
    await whenAccountReady();
    const data = current();
    return {
      data,
      text: Object.entries(data).map(
        ([key, value]) => `${key}: ${typeof value === 'boolean' ? (value ? 'on' : 'off') : value}`
      ),
    };
  },

  async 'settings set'({ args }) {
    await whenAccountReady();
    const setter = SETTERS[args.setting!];
    if (!setter) {
      throw new CliError(
        `No setting "${args.setting}". Settings: ${Object.keys(SETTERS).join(', ')}.`,
        'usage'
      );
    }
    await setter(args.value!.toLowerCase());
    return { data: current(), text: `${args.setting} is now ${args.value}.` };
  },

  async apikey({ args }, { io }) {
    await whenAccountReady();
    const service = oneOf(args.service!, CREDENTIALS, 'service');
    const key = await readText(io, `${service} API key (empty removes it): `, true);
    await writeCredential(useIdentityStore.getState().activeAccountId!, service, key);
    return {
      data: { service, saved: Boolean(key.trim()) },
      text: key.trim() ? `Saved the ${service} key.` : `Removed the ${service} key.`,
    };
  },
} satisfies Record<string, CliHandler>;
