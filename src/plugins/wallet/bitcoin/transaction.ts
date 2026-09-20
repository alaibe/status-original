import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { concat, fromHex, u32le, u64le } from '@/lib/bytes';

import { hash160, NETWORK_PREFIX, type BitcoinNetwork } from './address';

export function hash256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

export function varint(value: number): Uint8Array {
  if (value < 0xfd) return Uint8Array.from([value]);
  if (value <= 0xffff) {
    const out = new Uint8Array(3);
    out[0] = 0xfd;
    new DataView(out.buffer).setUint16(1, value, true);
    return out;
  }
  const out = new Uint8Array(5);
  out[0] = 0xfe;
  new DataView(out.buffer).setUint32(1, value, true);
  return out;
}

export function scriptPubKey(address: string, network: BitcoinNetwork = 'mainnet'): Uint8Array {
  const decoded = bech32.decode(address as `${string}1${string}`);
  if (decoded.prefix !== NETWORK_PREFIX[network]) {
    throw new Error(`"${address}" is not a ${network} address.`);
  }
  const [version, ...data] = decoded.words;
  if (version !== 0) {
    throw new Error('Only witness v0 addresses are supported; that looks like Taproot.');
  }
  const program = bech32.fromWords(data);
  if (program.length !== 20 && program.length !== 32) {
    throw new Error('That witness program is the wrong length.');
  }
  return concat([Uint8Array.from([0x00, program.length]), program]);
}

export function scriptCode(publicKey: Uint8Array): Uint8Array {
  return concat([
    Uint8Array.from([0x76, 0xa9, 0x14]),
    hash160(publicKey),
    Uint8Array.from([0x88, 0xac]),
  ]);
}

export interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
}

export interface TxOutput {
  script: Uint8Array;
  value: bigint;
}

const SEQUENCE = 0xfffffffd;
const SIGHASH_ALL = 1;

function outpoint(utxo: Utxo): Uint8Array {
  return concat([fromHex(utxo.txid).reverse(), u32le(utxo.vout)]);
}

function serialiseOutput(output: TxOutput): Uint8Array {
  return concat([u64le(output.value), varint(output.script.length), output.script]);
}

export function sighash(
  inputs: Utxo[],
  outputs: TxOutput[],
  index: number,
  publicKey: Uint8Array
): Uint8Array {
  const hashPrevouts = hash256(concat(inputs.map(outpoint)));
  const hashSequence = hash256(concat(inputs.map(() => u32le(SEQUENCE))));
  const hashOutputs = hash256(concat(outputs.map(serialiseOutput)));
  const code = scriptCode(publicKey);

  return hash256(
    concat([
      u32le(2),
      hashPrevouts,
      hashSequence,
      outpoint(inputs[index]),
      varint(code.length),
      code,
      u64le(inputs[index].value),
      u32le(SEQUENCE),
      hashOutputs,
      u32le(0),
      u32le(SIGHASH_ALL),
    ])
  );
}

export function buildTransaction(
  inputs: Utxo[],
  outputs: TxOutput[],
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  const witnesses = inputs.map((_, index) => {
    const signature = secp256k1.sign(sighash(inputs, outputs, index, publicKey), privateKey);
    const der = concat([signature.toDERRawBytes(), Uint8Array.from([SIGHASH_ALL])]);
    return concat([
      Uint8Array.from([2]),
      varint(der.length),
      der,
      varint(publicKey.length),
      publicKey,
    ]);
  });

  return concat([
    u32le(2),
    Uint8Array.from([0x00, 0x01]),
    varint(inputs.length),
    ...inputs.map((utxo) => concat([outpoint(utxo), varint(0), u32le(SEQUENCE)])),
    varint(outputs.length),
    ...outputs.map(serialiseOutput),
    ...witnesses,
    u32le(0),
  ]);
}

export function virtualSize(inputCount: number, outputCount: number): number {
  const base = 10 + inputCount * 41 + outputCount * 31;
  const witness = 2 + inputCount * 108;
  return Math.ceil(base + witness / 4);
}
