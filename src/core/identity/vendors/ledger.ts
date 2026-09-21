import { registerVendor, type HardwareSigner } from '../hardware';
import { ledgerSigner, type AppEth } from './ledger-signer';

export const LEDGER_SERVICE_UUID = '13d63400-2c97-0004-0000-4c6564676572';

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
  default: new (transport: unknown) => AppEth;
}

/** Phones reach a Ledger over Bluetooth; see ledger.web.ts for USB. */
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

  return ledgerSigner(new AppEth(await Transport.open(deviceId)));
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
