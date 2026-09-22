import { UR, UREncoder, URDecoder } from '@ngraveio/bc-ur';
import * as Crypto from 'expo-crypto';
import type { Address, Hex } from 'viem';

import { stripHex, toHex } from '@/lib/bytes';

import { registerVendor, type HardwareSigner } from '../hardware';

function registry(): typeof import('@keystonehq/bc-ur-registry-eth') {
  // `require`, not `import()`: both defer evaluation, but `import()` needs ESM
  // support Jest does not have, so this way the deferral stays testable.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@keystonehq/bc-ur-registry-eth');
}

export type QrExchange = (request: {
  parts: string[];
  purpose: 'message' | 'transaction' | 'typedData';
}) => Promise<string>;

let exchange: QrExchange | null = null;

export function setQrExchange(fn: QrExchange | null): void {
  exchange = fn;
}

export function encodeUr(ur: UR, maxFragment = 200): string[] {
  const encoder = new UREncoder(ur, maxFragment);
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 256; i += 1) {
    const part = encoder.nextPart();
    if (seen.has(part)) break;
    seen.add(part);
    parts.push(part);
  }
  return parts;
}

export function decodeUr(frames: string[]): UR | null {
  const decoder = new URDecoder();
  for (const frame of frames) decoder.receivePart(frame);
  return decoder.isComplete() && decoder.isSuccess() ? decoder.resultUR() : null;
}

export interface KeystoneAccount {
  address: Address;
  path: string;
  xfp: string;
}

export function readAccountUr(ur: UR): KeystoneAccount {
  const { CryptoMultiAccounts } = registry();
  const accounts = CryptoMultiAccounts.fromCBOR(ur.cbor);
  const [key] = accounts.getKeys();
  if (!key) throw new Error('That QR did not contain an account.');

  const path = `m/${key.getOrigin().getPath()}`;
  const xfp = accounts.getMasterFingerprint().toString('hex');
  const address = `0x${key.getKey().toString('hex').slice(-40)}` as Address;

  return { address, path, xfp };
}

export function readSignatureUr(ur: UR): Hex {
  const { ETHSignature } = registry();
  const signature = ETHSignature.fromCBOR(ur.cbor);
  return `0x${signature.getSignature().toString('hex')}` as Hex;
}

function requestId(): string {
  const bytes = Crypto.getRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function keystoneSigner(account: KeystoneAccount): HardwareSigner {
  const ask = async (
    payload: Buffer,
    type: 'personalMessage' | 'typedTransaction' | 'typedData',
    purpose: 'message' | 'transaction' | 'typedData'
  ): Promise<Hex> => {
    if (!exchange) {
      throw new Error('Open the Keystone screen to scan, then try again.');
    }
    const { DataType, EthSignRequest } = registry();
    const request = EthSignRequest.constructETHRequest(
      payload,
      DataType[type],
      account.path,
      account.xfp,
      requestId(),
      1,
      account.address
    );
    const answer = await exchange({ parts: encodeUr(request.toUR()), purpose });
    const ur = decodeUr([answer]);
    if (!ur) throw new Error('That QR was not a complete signature.');
    return readSignatureUr(ur);
  };

  return {
    id: 'keystone',
    label: 'Keystone',

    async getAddress() {
      return account.address;
    },

    signMessage: (_path, message) =>
      ask(Buffer.from(message, 'utf8'), 'personalMessage', 'message'),

    signTransaction: (_path, serialized) =>
      ask(Buffer.from(stripHex(serialized), 'hex'), 'typedTransaction', 'transaction'),

    signTypedDataHashes: (_path, domainHash, messageHash) =>
      ask(
        Buffer.from(stripHex(domainHash) + stripHex(messageHash), 'hex'),
        'typedData',
        'typedData'
      ),
  };
}

let paired: KeystoneAccount | null = null;

export function setKeystoneAccount(account: KeystoneAccount | null): void {
  paired = account;
}

export function registerKeystone(): void {
  registerVendor({
    id: 'keystone',
    label: 'Keystone',
    connection: 'qr',
    async connect() {
      if (!paired) throw new Error('Scan the QR on your Keystone first.');
      return keystoneSigner(paired);
    },
  });
}
