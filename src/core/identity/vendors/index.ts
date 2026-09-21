import { registerKeystone } from './keystone-qr';
import { registerLedger } from './ledger';
import { registerTrezor } from './trezor-deeplink';

export function registerHardwareVendors(): void {
  registerLedger();
  registerKeystone();
  registerTrezor();
}
