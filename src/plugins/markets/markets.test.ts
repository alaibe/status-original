import {
  afterFiring,
  describeAlert,
  firedAlerts,
  parseAlert,
  symbolsToPoll,
  toAlert,
  type MarketAlert,
} from './alerts';
import { displaySymbol, formatPercent, normaliseSymbol } from './api';

const at = (spec: Parameters<typeof toAlert>[0], price = 100) =>
  toAlert(spec, price, 1_700_000_000);

describe('symbols', () => {
  it('accepts every spelling of the same market', () => {
    // Making the user know which spelling the venue wants would be a poor
    // command; "btc", "BTC/USDT" and "btcusdt" are one market.
    expect(normaliseSymbol('btc')).toBe('BTCUSDT');
    expect(normaliseSymbol('BTC/USDT')).toBe('BTCUSDT');
    expect(normaliseSymbol('btcusdt')).toBe('BTCUSDT');
    expect(normaliseSymbol(' eth ')).toBe('ETHUSDT');
  });

  it('leaves a real cross-pair alone', () => {
    // ETHBTC ends in a quote asset with a base in front of it, so it is
    // already a pair; appending USDT would invent a market.
    expect(normaliseSymbol('ethbtc')).toBe('ETHBTC');
    expect(normaliseSymbol('btc')).not.toBe('BTC');
  });

  it('renders a pair for humans', () => {
    expect(displaySymbol('BTCUSDT')).toBe('BTC/USDT');
    expect(displaySymbol('ETHBTC')).toBe('ETH/BTC');
  });

  it('signs percentages so a fall reads as one', () => {
    expect(formatPercent(3.456)).toBe('+3.46%');
    expect(formatPercent(-1.2)).toBe('-1.20%');
  });
});

describe('parsing an alert', () => {
  it('reads thresholds in both directions, words or symbols', () => {
    expect(parseAlert(['btc', 'above', '100000'])).toEqual({
      kind: 'above',
      symbol: 'BTCUSDT',
      price: 100000,
    });
    expect(parseAlert(['eth', '<', '2000'])).toEqual({
      kind: 'below',
      symbol: 'ETHUSDT',
      price: 2000,
    });
  });

  it('reads a percentage move', () => {
    expect(parseAlert(['sol', '5%'])).toEqual({ kind: 'move', symbol: 'SOLUSDT', percent: 5 });
  });

  it('tolerates a thousands separator', () => {
    expect(parseAlert(['btc', 'above', '100,000'])).toMatchObject({ price: 100000 });
  });

  it('explains itself rather than failing silently', () => {
    expect(parseAlert([])).toMatchObject({ error: expect.stringContaining('/alert') });
    expect(parseAlert(['btc'])).toMatchObject({ error: expect.stringContaining('which way') });
    expect(parseAlert(['btc', 'above', 'soon'])).toMatchObject({
      error: expect.stringContaining('price'),
    });
    expect(parseAlert(['btc', '0%'])).toMatchObject({
      error: expect.stringContaining('above zero'),
    });
  });
});

describe('firing', () => {
  const above = at({ kind: 'above', symbol: 'BTCUSDT', price: 100_000 });
  const below = at({ kind: 'below', symbol: 'ETHUSDT', price: 2_000 });
  const move = at({ kind: 'move', symbol: 'SOLUSDT', percent: 5 }, 200);

  it('fires a threshold on the crossing, not before', () => {
    expect(firedAlerts([above], { BTCUSDT: 99_999 })).toEqual([]);
    expect(firedAlerts([above], { BTCUSDT: 100_000 })).toHaveLength(1);
    expect(firedAlerts([below], { ETHUSDT: 1_999 })).toHaveLength(1);
    expect(firedAlerts([below], { ETHUSDT: 2_001 })).toEqual([]);
  });

  it('fires a move alert in either direction', () => {
    expect(firedAlerts([move], { SOLUSDT: 210 })).toHaveLength(1);
    expect(firedAlerts([move], { SOLUSDT: 190 })).toHaveLength(1);
    expect(firedAlerts([move], { SOLUSDT: 205 })).toEqual([]);
  });

  it('stays quiet about a market it could not price', () => {
    // fetchPrices drops markets it failed to read, and a missing price must
    // never be treated as a zero, which would fire every `below` at once.
    expect(firedAlerts([above, below], { BTCUSDT: 100_001 })).toHaveLength(1);
    expect(firedAlerts([below], {})).toEqual([]);
  });
});

describe('after firing', () => {
  it('clears a threshold alert, so it does not repeat every tick', () => {
    const alert = at({ kind: 'above', symbol: 'BTCUSDT', price: 100_000 });
    const fired = firedAlerts([alert], { BTCUSDT: 101_000 });

    expect(afterFiring([alert], fired)).toEqual([]);
  });

  it('re-baselines a move alert, so "every 5%" keeps meaning that', () => {
    const alert = at({ kind: 'move', symbol: 'SOLUSDT', percent: 5 }, 200);
    const fired = firedAlerts([alert], { SOLUSDT: 210 });

    const [next] = afterFiring([alert], fired) as [MarketAlert & { from: number }];
    expect(next.from).toBe(210);
    // The next 5% is measured from here, not from the original 200.
    expect(firedAlerts([next], { SOLUSDT: 215 })).toEqual([]);
    expect(firedAlerts([next], { SOLUSDT: 221 })).toHaveLength(1);
  });

  it('leaves untouched alerts alone', () => {
    const hit = at({ kind: 'above', symbol: 'BTCUSDT', price: 100_000 });
    const miss = at({ kind: 'above', symbol: 'ETHUSDT', price: 9_000 });
    const fired = firedAlerts([hit, miss], { BTCUSDT: 100_001, ETHUSDT: 3_000 });

    expect(afterFiring([hit, miss], fired)).toEqual([miss]);
  });
});

describe('polling plan', () => {
  it('asks the venue for each market once', () => {
    const alerts = [
      at({ kind: 'above', symbol: 'BTCUSDT', price: 1 }),
      at({ kind: 'below', symbol: 'BTCUSDT', price: 2 }),
      at({ kind: 'above', symbol: 'ETHUSDT', price: 3 }),
    ];
    expect(symbolsToPoll(alerts)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
});

describe('describing an alert', () => {
  it('reads back as something a person would have said', () => {
    expect(describeAlert(at({ kind: 'above', symbol: 'BTCUSDT', price: 100_000 }))).toBe(
      'BTC/USDT above 100,000.00'
    );
    expect(describeAlert(at({ kind: 'move', symbol: 'SOLUSDT', percent: 5 }, 200))).toContain(
      'moves 5%'
    );
  });
});
