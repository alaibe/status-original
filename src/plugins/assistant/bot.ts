import type { Bot } from '@/core/messaging/bots';
import { W } from '@/design/widgets';

export const STATUS_BOT_ID = 'status';

export function makeStatusBot(): Bot {
  return {
    id: STATUS_BOT_ID,
    name: 'Status',
    tagline: 'Notebook & commands · on-device',
    avatar: require('@/assets/images/status-avatar.png') as number,

    greeting,
  };
}

function greeting(): ReturnType<Bot['greeting']> {
  return [
    'Welcome to Status. Use this chat for notes, links and reminders. They are saved on this device. Use /commands to see what you can do here.',
    'Keep your recovery phrase somewhere safe. It restores your account keys, but not notes saved only on this device.',
    {
      kind: 'widget',
      fallback: 'Get started: /commands for commands, /plugins for plugins. Messaging networks: XMTP, Nostr and Waku.',
      widget: W.card([
        W.actions([
          { label: 'Commands', command: '/commands' },
          { label: 'Plugins', command: '/plugins' },
        ]),
        W.text('Learn about the messaging networks:'),
        W.link('XMTP', 'https://xmtp.org'),
        W.link('Nostr', 'https://nostr.com'),
        W.link('Waku', 'https://waku.org'),
      ], { title: 'Get started', icon: 'sparkles-outline' }),
    },
  ];
}
