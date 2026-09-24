import type { PluginContext, SlashCommand } from '@/core/plugins/types';

import { botsPlugin } from './index';
import type { KnownBot } from './types';

const PRICES = '0x1111111111111111111111111111111111111111';
const NOBODY = '0x2222222222222222222222222222222222222222';
const WEATHER = '0x3333333333333333333333333333333333333333';

jest.mock('@/lib/evm/ens', () => ({
  looksLikeEnsName: (v: string) => v.endsWith('.eth'),
  resolveName: async (v: string) =>
    ({ 'pricebot.eth': PRICES, 'nobody.eth': NOBODY })[v.toLowerCase()] ?? null,
}));

jest.mock('@/core/messaging/chat-store', () => ({
  xmtpSessionFor: (state: { sessions: Record<string, unknown> }) => state.sessions.xmtp,
  useChatStore: {
    getState: () => ({
      sessions: {
        xmtp: {
          resolvePeer: async (v: string) =>
            v === '0x2222222222222222222222222222222222222222' ? null : 'inbox-1',
        },
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
      startDm: async (a: string) => (a === NOBODY ? null : 'conv-1'),
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
  const command = commandsFor(context).find((c) => c.name === name || c.aliases?.includes(name))!;
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
    expect(result).toMatchObject({
      type: 'notice',
      message: expect.stringContaining('Prices added'),
    });
    expect(store['known-bots']).toEqual([
      expect.objectContaining({ address: PRICES, name: 'Prices', inboxId: 'inbox-1' }),
    ]);
  });

  it('reads a name@domain handle from the domain', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ address: WEATHER, name: 'Weather', description: 'Forecasts' })
        )
      );
    const { context, store } = makeContext();

    await run('addbot', ['weather@bots.example.org'], context);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://bots.example.org/.well-known/status-bot/weather.json'
    );
    expect(store['known-bots']).toEqual([
      expect.objectContaining({ address: WEATHER, name: 'Weather', description: 'Forecasts' }),
    ]);
    fetchMock.mockRestore();
  });

  it('refuses a handle the domain does not know', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 404 }));
    const { context } = makeContext();

    const { result } = await run('addbot', ['ghost@bots.example.org'], context);

    expect(result).toEqual({ type: 'error', message: 'Could not find ghost@bots.example.org.' });
    fetchMock.mockRestore();
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

describe('names', () => {
  it('names each added bot after what /addbot saved', async () => {
    const { context } = makeContext();
    await run('addbot', ['pricebot.eth', 'Prices'], context);

    expect(await botsPlugin.setup(context).names!()).toEqual({ 'inbox-1': 'Prices' });
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
