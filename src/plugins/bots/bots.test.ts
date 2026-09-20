import type { PluginContext, SlashCommand } from '@/core/plugins/types';

import { botsPlugin } from './index';
import type { KnownBot } from './types';

jest.mock('@/core/messaging/chat-store', () => ({
  xmtpSessionFor: (state: { sessions: Record<string, unknown> }) => state.sessions.xmtp,
  useChatStore: {
    getState: () => ({
      sessions: {
        xmtp: { resolvePeer: async (v: string) => (v.includes('nobody') ? null : 'inbox-1') },
      },
    }),
  },
}));

function makeContext(store: Record<string, unknown> = {}) {
  const sent: { conversationId: string; text: string }[] = [];
  const context = {
    manifest: { id: 'bots' },
    storage: {
      get: async (k: string) => store[k] ?? null,
      set: async (k: string, v: unknown) => {
        store[k] = v;
      },
      remove: async (k: string) => {
        delete store[k];
      },
    },
    chat: {
      startDm: async (a: string) => (a.includes('nobody') ? null : 'conv-1'),
      sendText: async (conversationId: string, text: string) => {
        sent.push({ conversationId, text });
      },
    },
  } as unknown as PluginContext;
  return { context, store, sent };
}

const commandsFor = (context: PluginContext) =>
  botsPlugin.setup(context).commands as SlashCommand[];

async function run(
  name: string,
  args: string[],
  context: PluginContext,
  conversationId = 'conv-1'
) {
  const command = commandsFor(context).find(
    (c) => c.name === name || c.aliases?.includes(name)
  )!;
  const said: string[] = [];
  const result = await command.run({
    rest: args.join(' '),
    args,
    conversationId,
    context,
    respond: async (c) => {
      said.push(typeof c === 'string' ? c : c.kind === 'widget' ? c.fallback : '');
    },
  });
  return { result, said: said.join('\n') };
}

describe('/addbot', () => {
  it('stores a bot once its inbox resolves', async () => {
    const { context, store } = makeContext();

    const { result, said } = await run('addbot', ['pricebot.eth', 'Prices'], context);

    expect(said).toBe('');
    expect(result).toMatchObject({ type: 'notice', message: expect.stringContaining('Prices added') });
    expect(store['known-bots']).toEqual([
      expect.objectContaining({ address: 'pricebot.eth', name: 'Prices', inboxId: 'inbox-1' }),
    ]);
  });

  it('refuses an address with nothing listening', async () => {
    const { context } = makeContext();
    const { result } = await run('addbot', ['nobody.eth'], context);

    expect(result).toEqual({
      type: 'error',
      message: expect.stringContaining('no XMTP inbox'),
    });
  });

  it('will not add the same bot twice', async () => {
    const { context } = makeContext();
    await run('addbot', ['pricebot.eth'], context);
    const { result } = await run('addbot', ['PriceBot.eth'], context);

    // Addresses and ENS names are not case sensitive.
    expect(result).toMatchObject({ type: 'error' });
  });
});

describe('/removebot', () => {
  it('forgets a bot but says the conversation stays', async () => {
    const bot: KnownBot = { address: 'pricebot.eth', name: 'Prices', addedAt: 0 };
    const { context, store } = makeContext({ 'known-bots': [bot] });

    const { result, said } = await run('removebot', ['pricebot.eth'], context);

    expect(store['known-bots']).toEqual([]);
    expect(said).toBe('');
    expect(result).toMatchObject({
      type: 'notice',
      message: expect.stringContaining('conversation stays'),
    });
  });

  it('reports one that was never added', async () => {
    const { context } = makeContext();
    const { result } = await run('removebot', ['ghost.eth'], context);
    expect(result).toMatchObject({ type: 'error' });
  });
});
describe('/startbot', () => {
  it('opens a conversation and sends the /start convention', async () => {
    const { context, sent } = makeContext();

    await run('startbot', ['pricebot.eth'], context);

    expect(sent).toEqual([{ conversationId: 'conv-1', text: '/start' }]);
  });

  it('sends /start in place when already in a conversation', async () => {
    const { context, sent } = makeContext();
    await run('startbot', [], context, 'conv-9');
    expect(sent).toEqual([{ conversationId: 'conv-9', text: '/start' }]);
  });
});

describe('the ui.widget content type', () => {
  it('falls back to readable text for clients that cannot render it', () => {
    const { context } = makeContext();
    const [spec] = botsPlugin.setup(context).contentTypes!;

    expect(spec.typeId).toBe('ui.widget');
    expect(spec.fallback({ fallback: 'Pick an option', widget: { kind: 'text', text: 'x' } })).toBe(
      'Pick an option'
    );
    // A malformed payload from an unknown bot must not blank the bubble.
    expect(spec.fallback({} as never)).toBe('Interactive message');
  });
});
