import type { Address, Hex } from 'viem';

import { stripHex } from '@/lib/bytes';

import { registerVendor, type HardwareSigner } from '../hardware';

export const LEDGER_SERVICE_UUID = '13d63400-2c97-0004-0000-4c6564676572';

// Status words carried by @ledgerhq/errors TransportStatusError.
const APP_NOT_OPEN_STATUS = new Set([0x6e00, 0x6511]);
const USER_DENIED_STATUS = 0x6985;

export interface LedgerDevice {
  id: string;
  name: string;
}

interface TransportModule {
  default: {
    listen(observer: {
      next(event: { type: string; descriptor: LedgerDevice }): void;
      error(error: unknown): void;
      complete(): void;
    }): { unsubscribe(): void };
    open(id: string): Promise<unknown>;
  };
}

interface EthModule {
  default: new (transport: unknown) => {
    getAddress(path: string, display?: boolean): Promise<{ address: string }>;
    signPersonalMessage(path: string, hex: string): Promise<{ v: number; r: string; s: string }>;
    signTransaction(
      path: string,
      rawTxHex: string,
      resolution?: unknown
    ): Promise<{ v: string; r: string; s: string }>;
    signEIP712HashedMessage(
      path: string,
      domainHex: string,
      structHex: string
    ): Promise<{ v: number; r: string; s: string }>;
  };
}

function toSignature(r: string, s: string, v: number | string): Hex {
  const parity = typeof v === 'number' ? v : parseInt(v, 16);
  const normalised = parity < 27 ? parity + 27 : parity;
  return `0x${stripHex(r).padStart(64, '0')}${stripHex(s).padStart(64, '0')}${normalised
    .toString(16)
    .padStart(2, '0')}` as Hex;
}

export async function scanForLedgers(
  onFound: (device: LedgerDevice) => void,
  onError: (error: unknown) => void
): Promise<() => void> {
  const { default: Transport } = (await import(
    '@ledgerhq/react-native-hw-transport-ble'
  )) as unknown as TransportModule;

  const subscription = Transport.listen({
    next: (event) => {
      if (event.type === 'add') onFound(event.descriptor);
    },
    error: onError,
    complete: () => {},
  });

  return () => subscription.unsubscribe();
}

export async function connectLedger(deviceId: string): Promise<HardwareSigner> {
  const [{ default: Transport }, { default: AppEth }] = await Promise.all([
    import('@ledgerhq/react-native-hw-transport-ble') as unknown as Promise<TransportModule>,
    import('@ledgerhq/hw-app-eth') as unknown as Promise<EthModule>,
  ]);

  const transport = await Transport.open(deviceId);
  const eth = new AppEth(transport);

  const explain = (error: unknown): never => {
    const { statusCode } = (error ?? {}) as { statusCode?: number };
    const message = error instanceof Error ? error.message : String(error);
    if (statusCode !== undefined && APP_NOT_OPEN_STATUS.has(statusCode)) {
      throw new Error('Open the Ethereum app on your Ledger, then try again.');
    }
    if (statusCode === USER_DENIED_STATUS || /denied|rejected/i.test(message)) {
      throw new Error('Rejected on the Ledger.');
    }
    throw error instanceof Error ? error : new Error(message);
  };

  return {
    id: 'ledger',
    label: 'Ledger',

    async getAddress(path) {
      const { address } = await eth.getAddress(path, false).catch(explain);
      return address as Address;
    },

    async signMessage(path, message) {
      const hex = Buffer.from(message, 'utf8').toString('hex');
      const { r, s, v } = await eth.signPersonalMessage(path, hex).catch(explain);
      return toSignature(r, s, v);
    },

    async signTransaction(path, serialized) {
      const { r, s, v } = await eth.signTransaction(path, stripHex(serialized)).catch(explain);
      return toSignature(r, s, v);
    },

    async signTypedDataHashes(path, domainHash, messageHash) {
      const { r, s, v } = await eth
        .signEIP712HashedMessage(path, stripHex(domainHash), stripHex(messageHash))
        .catch(explain);
      return toSignature(r, s, v);
    },
  };
}

export function registerLedger(): void {
  registerVendor({
    id: 'ledger',
    label: 'Ledger',
    connection: 'bluetooth',
    scan: scanForLedgers,
    connect: (deviceId) => {
      if (!deviceId) throw new Error('Pick a Ledger from the list first.');
      return connectLedger(deviceId);
    },
  });
}
