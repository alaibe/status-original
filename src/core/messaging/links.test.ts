import { firstUrl, segmentText } from './links';

const links = (text: string) => segmentText(text).filter((s) => s.kind !== 'text');

describe('segmentText', () => {
  it('leaves plain prose as one segment', () => {
    expect(segmentText('hello there')).toEqual([{ kind: 'text', text: 'hello there' }]);
  });

  it('links a URL with a scheme and keeps the surrounding text', () => {
    expect(segmentText('see https://github.com/tauri-apps/tauri now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'url', text: 'https://github.com/tauri-apps/tauri', href: 'https://github.com/tauri-apps/tauri' },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('links www. and bare domains with a known ending, adding https', () => {
    expect(links('www.example.org and laravel-news.com/vacuum-laravel')).toEqual([
      { kind: 'url', text: 'www.example.org', href: 'https://www.example.org' },
      { kind: 'url', text: 'laravel-news.com/vacuum-laravel', href: 'https://laravel-news.com/vacuum-laravel' },
    ]);
  });

  it('does not treat file names or abbreviations as domains', () => {
    expect(links('edit message-bubble.tsx, index.ts and node.js e.g. today')).toEqual([]);
  });

  it('drops trailing punctuation and an unbalanced closing bracket', () => {
    expect(links('(see https://x.com/jack/status/20). Wow!').map((s) => s.text)).toEqual([
      'https://x.com/jack/status/20',
    ]);
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)').map((s) => s.text)).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it('links email addresses rather than the domain inside them', () => {
    expect(links('write to anthony@example.com.')).toEqual([
      { kind: 'email', text: 'anthony@example.com', href: 'mailto:anthony@example.com' },
    ]);
  });

  it('links phone numbers in common layouts', () => {
    const cases: [string, string][] = [
      ['+33 6 12 34 56 78', 'tel:+33612345678'],
      ['06.12.34.56.78', 'tel:0612345678'],
      ['(555) 123-4567', 'tel:5551234567'],
      ['DUNS number: 276786941', 'tel:276786941'],
    ];
    for (const [text, href] of cases) {
      expect(links(text).map((s) => [s.kind, s.href])).toEqual([['phone', href]]);
    }
  });

  it('keeps digits inside a link as part of the link', () => {
    expect(links('https://x.com/jack/status/1234567890').map((s) => s.kind)).toEqual(['url']);
  });

  it('does not mistake dates, decimals, amounts, hashes or short numbers for phones', () => {
    for (const text of [
      'on 2026-09-21 at 21:42',
      'on 21.09.2026',
      'costs 1234567.89',
      'paid $1234567',
      'order #276786941',
      'tx 0x00000000000000000000000000000000000000000000000000000000012345678',
      'room 1234',
      'v1.2345678',
    ]) {
      expect(links(text)).toEqual([]);
    }
  });
});

describe('firstUrl', () => {
  it('returns the first link as an absolute URL, ignoring phones and emails', () => {
    expect(firstUrl('call 0612345678 or mail a@b.co, or see x.com/foo then github.com')).toBe(
      'https://x.com/foo'
    );
    expect(firstUrl('nothing here')).toBeNull();
  });
});

describe('segmentText: addresses, names and places', () => {
  it('links Ethereum, Bitcoin and Solana addresses to their explorers', () => {
    const evm = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const bech32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const legacy = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
    const solana = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
    expect(links(`${evm} ${bech32} ${legacy} ${solana}`)).toEqual([
      { kind: 'address', family: 'evm', text: evm, href: `https://etherscan.io/address/${evm}` },
      { kind: 'address', family: 'bitcoin', text: bech32, href: `https://mempool.space/address/${bech32}` },
      { kind: 'address', family: 'bitcoin', text: legacy, href: `https://mempool.space/address/${legacy}` },
      { kind: 'address', family: 'solana', text: solana, href: `https://solscan.io/account/${solana}` },
    ]);
  });

  it('leaves transaction hashes, hex fragments and random words alone', () => {
    expect(
      links('tx 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045d8dA6BF26964aF9D7eEd9e03E53415D3')
    ).toEqual([]);
    expect(links('Supercalifragilisticexpialidocious rocks')).toEqual([]);
    expect(links('key bc1QAR0srrr7xfkvy5l643lydnw9re59gtzz')).toEqual([]);
  });

  it('links ENS names to the ENS app', () => {
    expect(links("pay Vitalik.eth's tip jar")).toEqual([
      { kind: 'ens', text: 'Vitalik.eth', href: 'https://app.ens.domains/vitalik.eth' },
    ]);
  });

  it('links geo URIs as locations', () => {
    expect(links('meet at geo:48.8584,2.2945?q=Eiffel%20Tower.')).toEqual([
      {
        kind: 'location',
        text: 'geo:48.8584,2.2945?q=Eiffel%20Tower',
        href: 'geo:48.8584,2.2945?q=Eiffel%20Tower',
      },
    ]);
  });
});
