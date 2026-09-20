import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';

import { concat } from '@/lib/bytes';

const SYSTEM_PROGRAM = new Uint8Array(32);

const TRANSFER = 2;

export function encodeLength(value: number): Uint8Array {
  if (value < 0 || value > 0xffff) throw new Error(`Length ${value} is out of range`);
  const out: number[] = [];
  let rest = value;
  for (;;) {
    if (rest < 0x80) {
      out.push(rest);
      break;
    }
    out.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return Uint8Array.from(out);
}

export interface TransferParams {
  from: Uint8Array;
  to: Uint8Array;
  lamports: bigint;
  blockhash: string;
}

export function transferData(lamports: bigint): Uint8Array {
  if (lamports < 0n || lamports > 0xffffffffffffffffn) {
    throw new Error('Amount is out of range');
  }
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, TRANSFER, true);
  view.setBigUint64(4, lamports, true);
  return data;
}

export function buildTransferMessage({ from, to, lamports, blockhash }: TransferParams): Uint8Array {
  if (from.length !== 32 || to.length !== 32) throw new Error('Keys must be 32 bytes');

  const recent = base58.decode(blockhash);
  if (recent.length !== 32) throw new Error('Blockhash must decode to 32 bytes');

  const keys = [from, to, SYSTEM_PROGRAM];

  return concat([
    Uint8Array.from([1, 0, 1]),
    encodeLength(keys.length),
    ...keys,
    recent,
    encodeLength(1),
    Uint8Array.from([2]),
    encodeLength(2),
    Uint8Array.from([0, 1]),
    ...(() => {
      const data = transferData(lamports);
      return [encodeLength(data.length), data];
    })(),
  ]);
}

export function signTransaction(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  const signature = ed25519.sign(message, privateKey);
  return concat([encodeLength(1), signature, message]);
}

export function transactionId(signed: Uint8Array): string {
  return base58.encode(signed.slice(1, 65));
}
