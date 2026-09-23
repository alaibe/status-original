import { DraftSync, flushDrafts, saveDraftsSoon, withDraft } from './drafts';

describe('drafts', () => {
  it('keeps a draft per chat and drops an empty one', () => {
    const drafts = withDraft(withDraft({}, 'a', 'hello'), 'b', 'world');
    expect(withDraft(drafts, 'a', '')).toEqual({ b: 'world' });
  });

  it('writes once typing pauses, with the latest drafts', () => {
    jest.useFakeTimers();
    const set = jest.fn(async () => {});
    const storage = { set } as never;
    saveDraftsSoon(storage, { a: 'h' });
    saveDraftsSoon(storage, { a: 'hi' });
    expect(set).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('chat.drafts', { a: 'hi' });
    jest.useRealTimers();
  });

  it('writes the pending drafts of one account before saving another', () => {
    jest.useFakeTimers();
    const first = jest.fn(async () => {});
    const second = jest.fn(async () => {});
    saveDraftsSoon({ set: first } as never, { a: 'one' });
    saveDraftsSoon({ set: second } as never, { b: 'two' });
    expect(first).toHaveBeenCalledWith('chat.drafts', { a: 'one' });
    flushDrafts();
    expect(second).toHaveBeenCalledWith('chat.drafts', { b: 'two' });
    jest.useRealTimers();
  });
});

describe('DraftSync', () => {
  afterEach(() => jest.useRealTimers());

  it('saves on the network once typing pauses, and ignores its own echo', () => {
    jest.useFakeTimers();
    const sync = new DraftSync();
    const push = jest.fn(async () => {});
    sync.typed('c', 'h', push);
    sync.typed('c', 'hi', push);
    jest.runAllTimers();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('hi');
    expect(sync.received('c', 'hi', 'hi')).toBeUndefined();
  });

  it('takes a draft typed on another device only while ours is unchanged', () => {
    const sync = new DraftSync();
    expect(sync.received('c', 'from phone', '')).toBe('from phone');
    expect(sync.received('c', 'edited on phone', 'from phone')).toBe('edited on phone');
    expect(sync.received('c', 'again', 'mine now')).toBeUndefined();
  });

  it('keeps what is being typed here', () => {
    jest.useFakeTimers();
    const sync = new DraftSync();
    sync.typed('c', 'typing', async () => {});
    expect(sync.received('c', 'elsewhere', 'typing')).toBeUndefined();
  });
});
