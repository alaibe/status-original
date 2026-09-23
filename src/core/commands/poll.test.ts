import { parseCommand } from './parser';
import { pollCommand } from './poll';
import { useChatStore } from '@/core/messaging/chat-store';

describe('/poll', () => {
  const original = useChatStore.getState();
  afterEach(() => useChatStore.setState(original, true));

  it('sends quoted choices to the poll capability', async () => {
    const createPoll = jest.fn(async () => {});
    useChatStore.setState({
      conversations: [
        {
          id: 'telegram-42',
          kind: 'group',
          title: 'Team',
          memberIds: [],
          createdAt: 0,
          consent: 'allowed',
          canSend: true,
        },
      ],
      createPoll,
    });
    const parsed = parseCommand('/poll "Where to eat?" "Pizza place" "Soup bar"')!;
    expect(
      await pollCommand.run({
        ...parsed,
        conversationId: 'telegram-42',
        respond: async () => {},
        context: {} as never,
      })
    ).toEqual({ type: 'handled' });
    expect(createPoll).toHaveBeenCalledWith('telegram-42', 'Where to eat?', [
      'Pizza place',
      'Soup bar',
    ]);
  });
});
