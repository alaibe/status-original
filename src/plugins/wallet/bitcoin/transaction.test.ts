import { secp256k1 } from '@noble/curves/secp256k1.js';

import { p2wpkhAddress } from './address';
import { fromHex, toHex } from '@/lib/bytes';

import {
  buildTransaction,
  hash256,
  scriptCode,
  scriptPubKey,
  sighash,
  varint,
  virtualSize,
} from './transaction';

const priv = new Uint8Array(32).fill(9);
const pub = secp256k1.getPublicKey(priv, true);
const address = p2wpkhAddress(pub);

describe('varint', () => {
  it('is one byte below 0xfd, then prefixed', () => {
    expect([...varint(0)]).toEqual([0]);
    expect([...varint(252)]).toEqual([252]);
    expect([...varint(253)]).toEqual([0xfd, 0xfd, 0x00]);
    expect([...varint(0x10000)]).toEqual([0xfe, 0x00, 0x00, 0x01, 0x00]);
  });
});

describe('scriptPubKey', () => {
  it('is OP_0 then the 20-byte hash for P2WPKH', () => {
    const script = scriptPubKey(address);
    expect(script[0]).toBe(0x00);
    expect(script[1]).toBe(0x14);
    expect(script).toHaveLength(22);
  });

  it('refuses Taproot rather than decoding it wrongly', () => {
    // A v1 address is bech32m; decoding it as bech32 yields a plausible and
    // completely wrong script, so the money would go nowhere recoverable.
    expect(() => scriptPubKey('bc1p' + 'q'.repeat(58))).toThrow();
  });

  it('refuses an address from the other network', () => {
    expect(() => scriptPubKey(p2wpkhAddress(pub, 'testnet'), 'mainnet')).toThrow(/mainnet/);
  });
});

describe('scriptCode', () => {
  it('is the legacy P2PKH form BIP-143 requires', () => {
    const code = scriptCode(pub);
    expect(code).toHaveLength(25);
    // OP_DUP OP_HASH160 <20> … OP_EQUALVERIFY OP_CHECKSIG
    expect([...code.slice(0, 3)]).toEqual([0x76, 0xa9, 0x14]);
    expect([...code.slice(23)]).toEqual([0x88, 0xac]);
  });
});

describe('sighash', () => {
  const inputs = [{ txid: 'ab'.repeat(32), vout: 0, value: 100_000n }];
  const outputs = [{ script: scriptPubKey(address), value: 90_000n }];

  it('is 32 bytes and commits to the input amount', () => {
    const a = sighash(inputs, outputs, 0, pub);
    const b = sighash([{ ...inputs[0], value: 100_001n }], outputs, 0, pub);

    expect(a).toHaveLength(32);
    // BIP-143's whole point: the pre-image commits to what is being spent, so
    // a wallet cannot be lied to about the amount.
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('changes when an output changes', () => {
    const moved = [{ script: scriptPubKey(address), value: 89_999n }];
    expect(toHex(sighash(inputs, outputs, 0, pub))).not.toBe(toHex(sighash(inputs, moved, 0, pub)));
  });
});

describe('buildTransaction', () => {
  const inputs = [{ txid: '11'.repeat(32), vout: 1, value: 200_000n }];
  const outputs = [{ script: scriptPubKey(address), value: 190_000n }];
  const tx = buildTransaction(inputs, outputs, priv, pub);

  it('marks itself as a witness transaction', () => {
    // version 2, then the 0x00 0x01 marker and flag.
    expect([...tx.slice(0, 6)]).toEqual([2, 0, 0, 0, 0x00, 0x01]);
  });

  it('serialises the outpoint little-endian', () => {
    // txids are shown big-endian and serialised reversed; getting this
    // backwards spends an input that does not exist.
    const at = 6 + 1;
    expect(toHex(tx.slice(at, at + 32))).toBe('11'.repeat(32));
    expect([...tx.slice(at + 32, at + 36)]).toEqual([1, 0, 0, 0]);
  });

  it('carries a signature the public key verifies against the sighash', () => {
    // Parsed from the tail rather than at a fixed offset: DER signatures are
    // 70-72 bytes depending on the values, so an assumed length is a test that
    // passes or fails by luck.
    const end = tx.length - 4; // before the locktime
    const pubkey = tx.slice(end - 33, end);
    expect(toHex(pubkey)).toBe(toHex(pub));
    expect(tx[end - 34]).toBe(33); // the pubkey's length prefix

    // Find the signature's own length prefix by walking back over it.
    const sigEnd = end - 34;
    let der: Uint8Array | null = null;
    for (let len = 68; len <= 74; len += 1) {
      if (tx[sigEnd - len - 1] === len) {
        der = tx.slice(sigEnd - len, sigEnd);
        break;
      }
    }
    expect(der).not.toBeNull();
    if (!der) return;

    // The trailing byte is the sighash type, not part of the signature.
    expect(der[der.length - 1]).toBe(1);
    const digest = sighash(inputs, outputs, 0, pub);
    expect(
      secp256k1.verify(der.slice(0, der.length - 1), digest, pub, { format: 'der', prehash: false })
    ).toBe(true);
  });

  it('ends with a zero locktime', () => {
    expect([...tx.slice(-4)]).toEqual([0, 0, 0, 0]);
  });
});

describe('virtualSize', () => {
  it('discounts witness bytes fourfold', () => {
    // A one-in two-out P2WPKH spend is ~141 vbytes. Charging the raw byte
    // length would overpay by roughly a third.
    expect(virtualSize(1, 2)).toBeGreaterThan(130);
    expect(virtualSize(1, 2)).toBeLessThan(155);
  });

  it('grows with each input', () => {
    expect(virtualSize(2, 2) - virtualSize(1, 2)).toBeGreaterThan(60);
  });
});

describe('hash256', () => {
  it('is double SHA-256', () => {
    expect(toHex(hash256(new Uint8Array()))).toBe(
      '5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456'
    );
  });
});

describe('hex', () => {
  it('round-trips', () => {
    expect(toHex(fromHex('00ff1a'))).toBe('00ff1a');
  });
});
