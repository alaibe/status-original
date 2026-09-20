import { displaySymbol, formatPrice, normaliseSymbol } from './api';

export interface ThresholdAlert {
  id: string;
  symbol: string;
  kind: 'above' | 'below';
  price: number;
  createdAt: number;
}

export interface MoveAlert {
  id: string;
  symbol: string;
  kind: 'move';
  percent: number;
  from: number;
  createdAt: number;
}

export type MarketAlert = ThresholdAlert | MoveAlert;

export type AlertSpec =
  | { kind: 'above' | 'below'; symbol: string; price: number }
  | { kind: 'move'; symbol: string; percent: number };

export function parseAlert(args: string[]): AlertSpec | { error: string } {
  const [rawSymbol, ...rest] = args;
  if (!rawSymbol) {
    return { error: 'Which market? /alert btc above 100000, or /alert btc 5%' };
  }

  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) return { error: `"${rawSymbol}" is not a market symbol.` };

  const percent = rest.length === 1 ? parsePercent(rest[0]) : null;
  if (percent !== null) {
    if (percent <= 0) return { error: 'A move alert needs a percentage above zero.' };
    return { kind: 'move', symbol, percent };
  }

  const direction = parseDirection(rest[0]);
  if (!direction) {
    return {
      error: 'Say which way: /alert btc above 100000, /alert btc below 80000, or /alert btc 5%',
    };
  }

  const price = Number(rest[1]?.replace(/[,_]/g, ''));
  if (!Number.isFinite(price) || price <= 0) {
    return { error: `Give me a price: /alert ${rawSymbol} ${direction} 100000` };
  }

  return { kind: direction, symbol, price };
}

function parseDirection(value: string | undefined): 'above' | 'below' | null {
  switch (value?.toLowerCase()) {
    case 'above':
    case 'over':
    case '>':
      return 'above';
    case 'below':
    case 'under':
    case '<':
      return 'below';
    default:
      return null;
  }
}

function parsePercent(value: string): number | null {
  const match = /^([\d.]+)%$/.exec(value);
  return match ? Number(match[1]) : null;
}

export function toAlert(spec: AlertSpec, price: number, now: number): MarketAlert {
  const id = `${spec.symbol}:${now.toString(36)}`;
  return spec.kind === 'move'
    ? { id, symbol: spec.symbol, kind: 'move', percent: spec.percent, from: price, createdAt: now }
    : { id, symbol: spec.symbol, kind: spec.kind, price: spec.price, createdAt: now };
}

export interface FiredAlert {
  alert: MarketAlert;
  price: number;
}

export function firedAlerts(
  alerts: MarketAlert[],
  prices: Record<string, number>
): FiredAlert[] {
  const fired: FiredAlert[] = [];

  for (const alert of alerts) {
    const price = prices[alert.symbol];
    if (price === undefined || !Number.isFinite(price)) continue;

    if (hasFired(alert, price)) fired.push({ alert, price });
  }

  return fired;
}

function hasFired(alert: MarketAlert, price: number): boolean {
  switch (alert.kind) {
    case 'above':
      return price >= alert.price;
    case 'below':
      return price <= alert.price;
    case 'move':
      return (
        alert.from > 0 && (Math.abs(price - alert.from) / alert.from) * 100 >= alert.percent
      );
  }
}

export function afterFiring(alerts: MarketAlert[], fired: FiredAlert[]): MarketAlert[] {
  const byId = new Map(fired.map((f) => [f.alert.id, f.price]));

  return alerts.flatMap((alert) => {
    const price = byId.get(alert.id);
    if (price === undefined) return [alert];
    return alert.kind === 'move' ? [{ ...alert, from: price }] : [];
  });
}

export function describeAlert(alert: MarketAlert): string {
  const market = displaySymbol(alert.symbol);
  return alert.kind === 'move'
    ? `${market} moves ${alert.percent}% from ${formatPrice(alert.from)}`
    : `${market} ${alert.kind} ${formatPrice(alert.price)}`;
}

export function symbolsToPoll(alerts: MarketAlert[]): string[] {
  return [...new Set(alerts.map((a) => a.symbol))];
}
