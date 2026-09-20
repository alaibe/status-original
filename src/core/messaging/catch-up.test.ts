import { InMemoryMessageStore } from './message-store';
import {
  flushWrites,
  STORE_TEST_PEER as THEM,
  STORE_TEST_SELF as ME,
  storeBackedSession as sessionOn,
} from './testing/store';

describe('the catch-up cursor', () => {
  it('is undefined on a device with no history', async () => {
    const store = new InMemoryMessageStore();
    const { session, transport } = await sessionOn(store);

    await session.createDm(THEM);
    await flushWrites();

    expect(transport.openCursors).toEqual([undefined]);
  });

  it('is the newest stored message when there is history', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    await first.session.createDm(THEM);
    await first.transport.receive('m1', 1_000);
    await first.transport.receive('m2', 9_000);
    await first.transport.receive('m3', 5_000);
    await flushWrites();

    const second = await sessionOn(store);

    expect(second.transport.openCursors).toEqual([9_000]);
  });

  it('reports the newest across every conversation for a global subscription', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    await first.transport.receive('m1', 4_000);
    await flushWrites();
    await first.transport.sink?.deliverToParticipants([ME, 'other'], {
      id: 'm2',
      senderId: 'other',
      sentAt: 12_000,
      transportTimestamp: 12_000,
      content: { kind: 'text', text: 'hi' },
      fromMe: false,
    });
    await flushWrites();

    const second = await sessionOn(store);
    await expect(second.session.newestSeenAt()).resolves.toBe(12_000);
  });

  it('has no cursor at all when nothing was ever stored', async () => {
    const { session } = await sessionOn(new InMemoryMessageStore());
    await expect(session.newestSeenAt()).resolves.toBeUndefined();
  });

  it('advances as new messages arrive, so the next launch asks from further on', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    await first.transport.receive('m1', 1_000);
    await flushWrites();

    const second = await sessionOn(store);
    expect(second.transport.openCursors).toEqual([1_000]);
    await second.transport.receive('m2', 20_000);
    await flushWrites();

    const third = await sessionOn(store);
    expect(third.transport.openCursors).toEqual([20_000]);
  });

  it('does not open a conversation that was left', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    const conversation = await first.session.createDm(THEM);
    await first.transport.receive('m1', 1_000);
    await flushWrites();
    await first.session.leaveGroup(conversation.id);

    const second = await sessionOn(store);
    expect(second.transport.openCursors).toEqual([]);
  });
});
