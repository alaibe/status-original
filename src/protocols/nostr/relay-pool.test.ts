import { signEvent, type NostrEvent } from './events';
import { identityFromSecretKey } from './keys';
import { normalizeRelayUrl, RelayPool } from './relay-pool';
import { fakeRelayFactory } from './testing/fake-relay';

const alice = identityFromSecretKey(new Uint8Array(32).fill(1));

function anEvent(content = 'hi'): NostrEvent {
  return signEvent(
    { pubkey: alice.publicKey, created_at: 1, kind: 1, tags: [], content },
    alice.secretKey
  );
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('normalizeRelayUrl', () => {
  it('assumes wss for a bare host, which is what people paste', () => {
    expect(normalizeRelayUrl('relay.example')).toBe('wss://relay.example');
  });

  it('strips a trailing slash so the same relay is not opened twice', () => {
    expect(normalizeRelayUrl('wss://relay.example/')).toBe('wss://relay.example');
  });

  it('rejects a non-websocket scheme', () => {
    expect(normalizeRelayUrl('https://relay.example')).toBeNull();
    expect(normalizeRelayUrl('   ')).toBeNull();
  });
});

describe('connecting', () => {
  it('opens one socket per distinct relay', () => {
    const factory = fakeRelayFactory();
    new RelayPool({
      urls: ['wss://a.example', 'wss://a.example/', 'wss://b.example'],
      createSocket: factory.create,
    });
    expect(factory.relays.map((r) => r.url)).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('reports per-relay status', () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });

    expect(pool.states[0].status).toBe('connecting');
    factory.relays[0].open();
    expect(pool.states[0].status).toBe('open');
    expect(pool.openCount).toBe(1);
  });
});

describe('subscriptions', () => {
  it('does not retry rejected authentication or accept an unrelated OK', () => {
    const factory = fakeRelayFactory();
    const auth = anEvent();
    const authenticate = jest.fn(() => auth);
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create, authenticate });
    const relay = factory.relays[0];
    relay.open();
    pool.subscribe({ id: 'dm', filters: [{ kinds: [1059] }], onEvent: () => {} });
    relay.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge']) });
    relay.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge']) });
    expect(authenticate).toHaveBeenCalledTimes(1);
    relay.onmessage?.({ data: JSON.stringify(['OK', 'unrelated-event', true, '']) });
    relay.onmessage?.({ data: JSON.stringify(['OK', auth.id, false, 'restricted: subscription required']) });
    expect(relay.sent.filter((m) => m[0] === 'REQ')).toHaveLength(1);
    expect(pool.states[0].error).toBe('restricted: subscription required');
    pool.close();
  });

  it('sends a REQ to every open relay', () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({
      urls: ['wss://a.example', 'wss://b.example'],
      createSocket: factory.create,
    });
    for (const relay of factory.relays) relay.open();

    pool.subscribe({ id: 'sub1', filters: [{ kinds: [1059] }], onEvent: () => {} });

    for (const relay of factory.relays) {
      expect(relay.sent).toContainEqual(['REQ', 'sub1', { kinds: [1059] }]);
    }
  });

  it('replays subscriptions on a relay that connects later', () => {
    // A relay that was down at subscribe time must still get the REQ, or its
    // messages are silently missing for the life of the session.
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });

    pool.subscribe({ id: 'sub1', filters: [{ kinds: [1] }], onEvent: () => {} });
    expect(factory.relays[0].sent).toHaveLength(0);

    factory.relays[0].open();
    expect(factory.relays[0].sent).toContainEqual(['REQ', 'sub1', { kinds: [1] }]);
  });

  it('delivers events and dedupes across relays', () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({
      urls: ['wss://a.example', 'wss://b.example'],
      createSocket: factory.create,
    });
    for (const relay of factory.relays) relay.open();

    const seen: NostrEvent[] = [];
    pool.subscribe({ id: 'sub1', filters: [{}], onEvent: (e) => seen.push(e) });

    const event = anEvent();
    factory.relays[0].deliver('sub1', event);
    factory.relays[1].deliver('sub1', event);

    // The same event arrives from every relay holding it; the caller wants it
    // once.
    expect(seen).toHaveLength(1);
  });

  it('reports EOSE per relay', () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    factory.relays[0].open();

    const done: string[] = [];
    pool.subscribe({ id: 'sub1', filters: [{}], onEvent: () => {}, onEose: (url) => done.push(url) });
    factory.relays[0].eose('sub1');

    expect(done).toEqual(['wss://a.example']);
  });

  it('CLOSEs on unsubscribe and stops delivering', () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    factory.relays[0].open();

    const seen: NostrEvent[] = [];
    const stop = pool.subscribe({ id: 'sub1', filters: [{}], onEvent: (e) => seen.push(e) });
    stop();

    expect(factory.relays[0].sent).toContainEqual(['CLOSE', 'sub1']);
    factory.relays[0].deliver('sub1', anEvent());
    expect(seen).toHaveLength(0);
  });

  it('shrugs off junk a relay emits', () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    factory.relays[0].open();
    pool.subscribe({ id: 'sub1', filters: [{}], onEvent: () => {} });

    expect(() => factory.relays[0].garbage()).not.toThrow();
  });
});

describe('publishing', () => {
  it('goes to every open relay and resolves after a positive OK', async () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({
      urls: ['wss://a.example', 'wss://b.example'],
      createSocket: factory.create,
    });
    factory.relays[0].open();
    // b stays closed.

    const event = anEvent();
    await expect(pool.publish(event)).resolves.toBeUndefined();
    expect(factory.relays[0].published).toEqual([event]);
    expect(factory.relays[1].published).toEqual([]);
  });

  it('rejects when nothing is connected', async () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    await expect(pool.publish(anEvent())).rejects.toThrow(/No relay accepted/);
  });

  it('does not treat a successful socket write as relay acceptance', async () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    const relay = factory.relays[0];
    relay.autoAcceptPublications = false;
    relay.open();

    const event = anEvent();
    let settled = false;
    const publishing = pool.publish(event).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    relay.acknowledge(event.id, true);
    await publishing;
    expect(settled).toBe(true);
  });

  it('rejects after every relay rejects the event', async () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({
      urls: ['wss://a.example', 'wss://b.example'],
      createSocket: factory.create,
    });
    for (const relay of factory.relays) {
      relay.autoAcceptPublications = false;
      relay.open();
    }

    const event = anEvent();
    const publishing = pool.publish(event);
    factory.relays[0].acknowledge(event.id, false, 'blocked: policy');
    factory.relays[1].acknowledge(event.id, false, 'rate-limited');
    await expect(publishing).rejects.toThrow(/blocked: policy; rate-limited/);
  });

  it('times out when an open relay never acknowledges', async () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    factory.relays[0].autoAcceptPublications = false;
    factory.relays[0].open();

    const publishing = pool.publish(anEvent());
    const rejected = expect(publishing).rejects.toThrow(/acknowledgment timed out/);
    await jest.advanceTimersByTimeAsync(15_000);
    await rejected;
  });

  it('authenticates and retries an auth-required publication', async () => {
    const factory = fakeRelayFactory();
    const auth = anEvent('auth');
    const pool = new RelayPool({
      urls: ['wss://a.example'],
      createSocket: factory.create,
      authenticate: () => auth,
    });
    const relay = factory.relays[0];
    relay.autoAcceptPublications = false;
    relay.open();

    const event = anEvent('private');
    const publishing = pool.publish(event);
    relay.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge']) });
    relay.acknowledge(event.id, false, 'auth-required: sign in');
    relay.acknowledge(auth.id, true);
    expect(relay.published).toEqual([event, event]);
    relay.acknowledge(event.id, true);
    await expect(publishing).resolves.toBeUndefined();
  });
});

describe('reconnecting', () => {
  it('retries with backoff after a drop, and replays the subscription', () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    factory.relays[0].open();
    pool.subscribe({ id: 'sub1', filters: [{ kinds: [1] }], onEvent: () => {} });

    factory.relays[0].close();
    expect(pool.states[0].status).toBe('closed');
    expect(factory.relays).toHaveLength(1);

    // Backoff is jittered between half and all of the ceiling, so advance past
    // the whole first window.
    jest.advanceTimersByTime(1_100);
    expect(factory.relays).toHaveLength(2);

    factory.relays[1].open();
    // A relay remembers nothing about a socket that dropped.
    expect(factory.relays[1].sent).toContainEqual(['REQ', 'sub1', { kinds: [1] }]);
  });

  it('lengthens the delay on repeated failures', () => {
    const factory = fakeRelayFactory();
    new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });

    factory.relays[0].close();
    jest.advanceTimersByTime(1_100);
    factory.relays[1].close();

    // The second window starts at 2s, so the first second is not enough.
    jest.advanceTimersByTime(900);
    expect(factory.relays).toHaveLength(2);
    jest.advanceTimersByTime(1_200);
    expect(factory.relays).toHaveLength(3);
  });

  it('stops retrying once closed', () => {
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    factory.relays[0].open();

    pool.close();
    jest.advanceTimersByTime(60_000);
    expect(factory.relays).toHaveLength(1);
  });

  it('does not reconnect a relay removed by setRelays', () => {
    // teardown() detaches the handlers first; without that, close() fires
    // onclose and schedules a reconnect for a relay we just dropped.
    const factory = fakeRelayFactory();
    const pool = new RelayPool({ urls: ['wss://a.example'], createSocket: factory.create });
    factory.relays[0].open();

    pool.setRelays(['wss://b.example']);
    jest.advanceTimersByTime(60_000);

    expect(factory.relays.map((r) => r.url)).toEqual(['wss://a.example', 'wss://b.example']);
  });
});
