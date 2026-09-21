import { base58 } from '@scure/base';

export type AddressFamily = 'evm' | 'bitcoin' | 'solana';

export type LinkKind = 'url' | 'phone' | 'email' | 'location' | 'ens';

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: LinkKind; text: string; href: string }
  | { kind: 'address'; family: AddressFamily; text: string; href: string };

export type LinkSegment = Exclude<Segment, { kind: 'text' }>;

// Bare domains (no scheme, no www.) only count with one of these endings, so
// "index.ts" and "e.g." stay prose while "github.com/foo" becomes a link.
const BARE_TLDS =
  'com|net|org|io|dev|app|co|me|xyz|info|ai|gg|tv|fm|so|sh|to|cc|ly|link|tech|site|' +
  'online|store|shop|blog|news|page|cloud|design|studio|agency|finance|fr|de|uk|us|eu|' +
  'ch|nl|es|it|be|ca|au|jp|br|in|ru|pl|se|no|fi|dk|cz|at|pt|ie|nz|kr|cn|hk|sg|tw|mx|' +
  'ar|cl|za|ph|id|th|vn|tr|il|ae|sa|ua|gr|hu|ro|bg|sk|si|hr|rs|lt|lv|ee|is|lu';

const EMAIL = `[\\w.+-]+@(?:[a-z0-9-]+\\.)+[a-z]{2,}`;
const URL = `(?:https?:\\/\\/|www\\.)[^\\s<>"'\`]+`;
const BARE_DOMAIN = `(?:[a-z0-9-]+\\.)+(?:${BARE_TLDS})(?::\\d{2,5})?(?:\\/[^\\s<>"'\`]*)?`;
const GEO = `geo:-?\\d+(?:\\.\\d+)?,-?\\d+(?:\\.\\d+)?(?:\\?[^\\s<>"'\`]*)?`;
const EVM = `0x[0-9a-f]{40}`;
const BECH32 = `(?:bc|tb)1[02-9ac-hj-np-z]{8,}`;
const BASE58 = `[1-9A-HJ-NP-Za-km-z]{25,44}`;
const ENS = `(?:[a-z0-9-]+\\.)+eth`;
const PHONE = `\\+?\\(?\\d(?:[\\d\\s().-]*\\d)?`;

const TOKEN = new RegExp(
  `(${EMAIL})|(${URL})|(${BARE_DOMAIN})|(${GEO})|(${EVM})|(${BECH32})|(${BASE58})|(${ENS})|(${PHONE})`,
  'gi'
);

const TRAILING_PUNCTUATION = /[.,;:!?'"\]}>]+$/;
const DATE = /^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4})$/;
const DECIMAL = /^\d+\.\d+$/;

export const EXPLORERS: Record<AddressFamily, { name: string; url: (address: string) => string }> = {
  evm: { name: 'Etherscan', url: (a) => `https://etherscan.io/address/${a}` },
  bitcoin: { name: 'mempool.space', url: (a) => `https://mempool.space/address/${a}` },
  solana: { name: 'Solscan', url: (a) => `https://solscan.io/account/${a}` },
};

export const ENS_APP = 'https://app.ens.domains/';

export function segmentText(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  const push = (segment: Segment) => {
    if (segment.text) segments.push(segment);
  };

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text))) {
    const link = classify(match, text);
    if (!link) {
      TOKEN.lastIndex = match.index + 1;
      continue;
    }

    push({ kind: 'text', text: text.slice(cursor, match.index) });
    push(link);
    cursor = match.index + link.text.length;
    TOKEN.lastIndex = cursor;
  }

  push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}

export function firstUrl(text: string): string | null {
  const link = segmentText(text).find((s) => s.kind === 'url');
  return link && link.kind === 'url' ? link.href : null;
}

function classify(match: RegExpExecArray, text: string): LinkSegment | null {
  const [, email, url, bare, geo, evm, bech32, base58Token, ens, phone] = match;
  const before = text[match.index - 1] ?? '';
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 2);
  const bounded = !/[\w@/.-]/.test(before) && !/^[\w]/.test(after);

  if (email) {
    return { kind: 'email', text: email, href: `mailto:${email}` };
  }

  if (url || bare) {
    if (/[\w@/.-]/.test(before)) return null;
    const trimmed = trimUrl(url ?? bare);
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return { kind: 'url', text: trimmed, href };
  }

  if (geo) {
    const trimmed = trimUrl(geo);
    return { kind: 'location', text: trimmed, href: trimmed };
  }

  if (evm && bounded) {
    return { kind: 'address', family: 'evm', text: evm, href: EXPLORERS.evm.url(evm) };
  }

  if (bech32 && bounded) {
    const mixedCase = /[a-z]/.test(bech32) && /[A-Z]/.test(bech32);
    if (mixedCase) return null;
    return { kind: 'address', family: 'bitcoin', text: bech32, href: EXPLORERS.bitcoin.url(bech32) };
  }

  if (base58Token && bounded) {
    const family = base58Family(base58Token);
    if (family) {
      return { kind: 'address', family, text: base58Token, href: EXPLORERS[family].url(base58Token) };
    }
    return null;
  }

  if (ens && bounded) {
    const name = ens.toLowerCase();
    return { kind: 'ens', text: ens, href: `${ENS_APP}${name}` };
  }

  if (phone && isPhone(phone, before, after)) {
    return { kind: 'phone', text: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` };
  }

  return null;
}

// Base58Check legacy Bitcoin addresses decode to 25 bytes, Solana public keys to 32.
function base58Family(token: string): AddressFamily | null {
  try {
    const length = base58.decode(token).length;
    if (length === 25 && /^[13mn2]/.test(token)) return 'bitcoin';
    if (length === 32) return 'solana';
  } catch {}
  return null;
}

function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const trimmed = url.replace(TRAILING_PUNCTUATION, '');
    const open = (trimmed.match(/\(/g) ?? []).length;
    const close = (trimmed.match(/\)/g) ?? []).length;
    const next = close > open && trimmed.endsWith(')') ? trimmed.slice(0, -1) : trimmed;
    if (next === url) return url;
    url = next;
  }
}

function isPhone(candidate: string, before: string, after: string): boolean {
  const digits = candidate.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return false;
  if (/[\w./+@#$€£-]/.test(before)) return false;
  if (/^\w/.test(after) || /^[./:-]\d/.test(after)) return false;
  if (/\s{2,}/.test(candidate)) return false;
  if (DATE.test(candidate) || DECIMAL.test(candidate)) return false;
  return true;
}
