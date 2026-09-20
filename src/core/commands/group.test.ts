import { router } from 'expo-router';

import { groupCommands } from './group';

/**
 * Core commands have no plugin context, and must not reach for one: the
 * registry hands them a proxy that throws on any access, so a `/profile` that
 * touched `context.ui.openProfile` would answer with that error in the thread
 * instead of opening anything.
 */
describe('/profile', () => {
  const profile = groupCommands.find((c) => c.name === 'profile')!;

  const run = (args: string[]) =>
    profile.run({
      args,
      rest: args.join(' '),
      conversationId: 'xmtp-abc',
      // The same proxy the registry passes core commands: any access throws.
      context: new Proxy(
        {},
        {
          get() {
            throw new Error('A core command reached for the plugin context.');
          },
        }
      ) as never,
      respond: async () => {},
    });

  beforeEach(() => {
    (router.push as jest.Mock).mockClear();
  });

  it('opens the profile without touching a plugin context', async () => {
    await expect(run([])).resolves.toEqual({ type: 'handled' });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/profile/[id]',
      params: { id: 'xmtp-abc' },
    });
  });

  it('names the member when one was given', async () => {
    await run(['0xabc']);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/profile/[id]',
      params: { id: 'xmtp-abc', member: '0xabc' },
    });
  });
});
