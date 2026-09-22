import {
  hashDomain,
  hashStruct,
  parseSignature,
  serializeTransaction,
  type Address,
  type Hex,
  type LocalAccount,
  type CustomSource,
  type SignableMessage,
  type TransactionSerializable,
} from 'viem';
import { toAccount } from 'viem/accounts';

import type { DerivedKey, Keyring } from './keyring';
import type { Ed25519Key } from './slip10';

export interface HardwareSigner {
  readonly id: string;
  readonly label: string;

  getAddress(path: string): Promise<Address>;

  signMessage(path: string, message: string): Promise<Hex>;

  signTransaction(path: string, serialized: Hex): Promise<Hex>;

  signTypedDataHashes?(path: string, domainHash: Hex, messageHash: Hex): Promise<Hex>;
}

export type HardwareConnection = 'bluetooth' | 'usb' | 'qr' | 'companion-app';

export interface HardwareVendor {
  id: string;
  label: string;
  connection: HardwareConnection;
  scan?(
    onFound: (device: { id: string; name: string }) => void,
    onError: (e: unknown) => void
  ): Promise<() => void>;
  connect(deviceId?: string): Promise<HardwareSigner>;
}

const vendors = new Map<string, HardwareVendor>();

export function registerVendor(vendor: HardwareVendor): void {
  vendors.set(vendor.id, vendor);
}

export function hardwareVendors(): HardwareVendor[] {
  return [...vendors.values()];
}

export function vendorIds(): string[] {
  return [...vendors.keys()];
}

export function vendor(id: string): HardwareVendor {
  const found = vendors.get(id);
  if (!found) throw new Error(`No hardware wallet called "${id}" is available.`);
  return found;
}

export async function connectVendor(id: string, deviceId?: string): Promise<HardwareSigner> {
  return vendor(id).connect(deviceId);
}

export const DEFAULT_EVM_PATH = "m/44'/60'/0'/0/0";

export function hardwareAccount(
  signer: HardwareSigner,
  address: Address,
  path: string = DEFAULT_EVM_PATH
): LocalAccount {
  const source: CustomSource = {
    address,
    async signMessage({ message }: { message: SignableMessage }) {
      const text = typeof message === 'string' ? message : message.raw.toString();
      return signer.signMessage(path, text);
    },
    async signTransaction(transaction: TransactionSerializable) {
      const unsigned = serializeTransaction(transaction);
      const signature = await signer.signTransaction(path, unsigned);
      return serializeTransaction(transaction, parseSignature(signature));
    },
    async signTypedData(typedData) {
      if (!signer.signTypedDataHashes) {
        throw new Error(`${signer.label} cannot show typed data, so it will not sign it.`);
      }
      const data = typedData as never;
      return signer.signTypedDataHashes(
        path,
        hashDomain({
          domain: (data as { domain: never }).domain,
          types: (data as { types: never }).types,
        }),
        hashStruct(data)
      );
    },
  };

  return toAccount(source);
}

export function hardwareKeyring(
  signer: HardwareSigner,
  address: Address,
  path: string = DEFAULT_EVM_PATH
): Keyring {
  const unavailable = (chain: string) => (): never => {
    throw new Error(
      `${chain} on a ${signer.label} needs its own app on the device, which this app does not speak yet.`
    );
  };

  return {
    kind: 'hardware',
    mnemonic: null,
    address,
    account: hardwareAccount(signer, address, path),
    derive: unavailable('Bitcoin') as (p: string) => DerivedKey,
    deriveEd25519: unavailable('Solana') as (p: string) => Ed25519Key,
  };
}
