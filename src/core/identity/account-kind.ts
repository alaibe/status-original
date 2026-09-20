export type AccountKind = 'phrase' | 'hardware';

export interface AccountCapabilities {
  chat: boolean;
  evm: boolean;
  otherChains: boolean;
  confirmsOnDevice: boolean;
}

export function capabilitiesOf(kind: AccountKind): AccountCapabilities {
  return kind === 'hardware'
    ? { chat: true, evm: true, otherChains: false, confirmsOnDevice: true }
    : { chat: true, evm: true, otherChains: true, confirmsOnDevice: false };
}

export function describeKind(kind: AccountKind): string {
  return kind === 'hardware'
    ? 'On a hardware wallet · confirms on the device'
    : 'On this device · recovery phrase';
}
