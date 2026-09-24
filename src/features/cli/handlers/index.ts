import type { CommandPath } from '../commands';
import type { CliHandler } from '../context';
import { accountHandlers } from './accounts';
import { appHandlers } from './app';
import { chatHandlers } from './chats';
import { groupHandlers } from './groups';
import { liveHandlers } from './live';
import { messageHandlers } from './messages';
import { networkHandlers } from './networks';
import { peopleHandlers } from './people';
import { pluginHandlers } from './plugins';
import { settingsHandlers } from './settings';

/** `quit` never reaches the page: the app answers it before the page could be stuck. */
export const HANDLERS: Record<Exclude<CommandPath, 'quit'>, CliHandler> = {
  ...appHandlers,
  ...accountHandlers,
  ...networkHandlers,
  ...chatHandlers,
  ...messageHandlers,
  ...peopleHandlers,
  ...groupHandlers,
  ...settingsHandlers,
  ...pluginHandlers,
  ...liveHandlers,
};
