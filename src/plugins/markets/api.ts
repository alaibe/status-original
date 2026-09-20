export const DEFAULT_API_BASE = 'https://api.binance.com/api/v3';

export const DEFAULT_QUOTE = 'USDT';

const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY'];

export interface Ticker {
  symbol: string;
  price: number;
  changePercent: number;
  high: number;
  low: number;
}

export function normaliseSymbol(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';

  const isPair = QUOTE_ASSETS.some(
    (quote) => cleaned.endsWith(quote) && cleaned.length - quote.length >= 2
  );

  return isPair ? cleaned : `${cleaned}${DEFAULT_QUOTE}`;
}

export function displaySymbol(symbol: string): string {
  const quote = QUOTE_ASSETS.find(
    (q) => symbol.endsWith(q) && symbol.length - q.length >= 2
  );
  return quote ? `${symbol.slice(0, -quote.length)}/${quote}` : symbol;
}

export function formatPrice(value: number): string {
  const decimals = value >= 1000 ? 2 : value >= 1 ? 4 : 8;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

interface TickerResponse {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
}

export async function fetchTicker(
  symbol: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<Ticker> {
  const response = await fetch(
    `${apiBase}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
  );

  if (!response.ok) {
    throw new Error(
      response.status === 400
        ? `${displaySymbol(symbol)} is not a market on this venue.`
        : response.status === 451
          ? 'That venue does not serve your region. Point /marketapi somewhere else.'
          : `Market data returned ${response.status}.`
    );
  }

  const body = (await response.json()) as TickerResponse;
  return {
    symbol: body.symbol ?? symbol,
    price: Number(body.lastPrice),
    changePercent: Number(body.priceChangePercent),
    high: Number(body.highPrice),
    low: Number(body.lowPrice),
  };
}

export async function fetchPrices(
  symbols: string[],
  apiBase: string = DEFAULT_API_BASE
): Promise<Record<string, number>> {
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return [symbol, (await fetchTicker(symbol, apiBase)).price] as const;
      } catch {
        return null;
      }
    })
  );

  return Object.fromEntries(
    results.filter((r): r is readonly [string, number] => r !== null && Number.isFinite(r[1]))
  );
}
