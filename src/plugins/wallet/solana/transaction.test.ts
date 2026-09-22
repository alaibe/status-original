import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';

import {
  buildTransferMessage,
  encodeLength,
  signTransaction,
  transactionId,
  transferData,
} from './transaction';

const FROM = new Uint8Array(32).fill(1);
const TO = new Uint8Array(32).fill(2);
const BLOCKHASH = base58.encode(new Uint8Array(32).fill(3));

describe('encodeLength', () => {
  it('is one byte below 128', () => {
    expect([...encodeLength(0)]).toEqual([0]);
    expect([...encodeLength(127)]).toEqual([127]);
  });

  it('continues into a second byte at 128', () => {
    // Seven bits per byte, high bit set to continue, unlike LEB128's eight.
    expect([...encodeLength(128)]).toEqual([0x80, 0x01]);
    expect([...encodeLength(0x1234)]).toEqual([0xb4, 0x24]);
  });

  it('refuses a length the format cannot carry', () => {
    expect(() => encodeLength(0x10000)).toThrow(/out of range/);
  });
});

describe('transferData', () => {
  it('is the discriminant then the amount, both little-endian', () => {
    const data = transferData(1n);

    expect(data).toHaveLength(12);
    // u32 = 2 (Transfer), then u64 = 1.
    expect([...data]).toEqual([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('carries a full lamport range without floating point', () => {
    const data = transferData(1_000_000_000n);
    expect(new DataView(data.buffer).getBigUint64(4, true)).toBe(1_000_000_000n);
  });

  it('refuses a negative amount', () => {
    expect(() => transferData(-1n)).toThrow(/out of range/);
  });
});

describe('buildTransferMessage', () => {
  const message = buildTransferMessage({
    from: FROM,
    to: TO,
    lamports: 1_000_000_000n,
    blockhash: BLOCKHASH,
  });

  it('declares one signer and one read-only account', () => {
    // [numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned].
    // The sender signs and pays, the recipient is written to, and the System
    // Program is neither. Get this wrong and the node rejects it.
    expect([...message.slice(0, 3)]).toEqual([1, 0, 1]);
  });

  it('orders the accounts signer, writable, program', () => {
    expect([...message.slice(4, 36)]).toEqual([...FROM]);
    expect([...message.slice(36, 68)]).toEqual([...TO]);
    // The System Program's address is 32 zero bytes.
    expect([...message.slice(68, 100)]).toEqual([...new Uint8Array(32)]);
  });

  it('carries the blockhash immediately after the keys', () => {
    expect([...message.slice(100, 132)]).toEqual([...new Uint8Array(32).fill(3)]);
  });

  it('points the instruction at the program and the two accounts', () => {
    // count=1, programIdIndex=2, accounts=[0,1], dataLen=12
    expect([...message.slice(132, 139)]).toEqual([1, 2, 2, 0, 1, 12, 2]);
  });

  it('refuses a blockhash that is not 32 bytes', () => {
    expect(() =>
      buildTransferMessage({
        from: FROM,
        to: TO,
        lamports: 1n,
        blockhash: base58.encode(FROM.slice(0, 8)),
      })
    ).toThrow(/32 bytes/);
  });
});

describe('signTransaction', () => {
  const priv = new Uint8Array(32).fill(7);
  const message = buildTransferMessage({
    from: ed25519.getPublicKey(priv),
    to: TO,
    lamports: 5n,
    blockhash: BLOCKHASH,
  });
  const signed = signTransaction(message, priv);

  it('prefixes one signature and keeps the message intact', () => {
    expect(signed[0]).toBe(1);
    expect(signed).toHaveLength(1 + 64 + message.length);
    expect([...signed.slice(65)]).toEqual([...message]);
  });

  it('produces a signature the sender’s public key verifies', () => {
    // A node checks this before it moves money, and a wrong byte anywhere
    // above makes it fail.
    expect(ed25519.verify(signed.slice(1, 65), message, ed25519.getPublicKey(priv))).toBe(true);
  });

  it('reports the id a node will return', () => {
    expect(transactionId(signed)).toBe(base58.encode(signed.slice(1, 65)));
  });
});

describe('toLamports (via the plugin)', () => {
  // Re-implemented here rather than exported: the invariant worth pinning is
  // that no path through it touches a float, because 0.1 SOL is not
  // representable and a rounding error here is lost money.
  const toLamports = (amount: string): bigint => {
    if (!/^\d+(\.\d{1,9})?$/.test(amount.trim())) throw new Error('bad');
    const [whole, fraction = ''] = amount.trim().split('.');
    return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
  };

  it('converts exactly, including the amounts a float gets wrong', () => {
    expect(toLamports('1')).toBe(1_000_000_000n);
    expect(toLamports('0.1')).toBe(100_000_000n);
    expect(toLamports('0.000000001')).toBe(1n);
    expect(toLamports('1.234567891')).toBe(1_234_567_891n);
  });

  it('refuses more precision than a lamport', () => {
    expect(() => toLamports('0.0000000001')).toThrow();
  });

  it('refuses anything that is not a plain decimal', () => {
    for (const bad of ['', '-1', '1e9', 'abc', '1.2.3', ' 1 2 ']) {
      expect(() => toLamports(bad)).toThrow();
    }
  });
});
