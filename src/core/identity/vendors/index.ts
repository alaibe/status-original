import { registerKeystone } from './keystone-qr';
import { registerLedger } from './ledger-ble';
import { registerTrezor } from './trezor-deeplink';

export function registerHardwareVendors(): void {
  registerLedger();
  registerKeystone();
  registerTrezor();
}
