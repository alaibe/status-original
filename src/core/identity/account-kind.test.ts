import { capabilitiesOf, describeKind } from './account-kind';

import { useIdentityStore } from './identity-store';

describe('capabilitiesOf', () => {
  it('lets a phrase account do everything', () => {
    expect(capabilitiesOf('phrase')).toEqual({
      chat: true,
      evm: true,
      otherChains: true,
      confirmsOnDevice: false,
    });
  });

  it('lets a hardware account chat', () => {
    // The signature XMTP asks for registers an installation. After that the
    // installation key signs, and `Client.build` reopens it with no signer,
    // so a Ledger signs once at setup and never per message or per launch.
    expect(capabilitiesOf('hardware').chat).toBe(true);
  });

  it('lets a hardware account spend, on the device', () => {
    expect(capabilitiesOf('hardware').evm).toBe(true);
    expect(capabilitiesOf('hardware').confirmsOnDevice).toBe(true);
  });

  it('does not claim Bitcoin and Solana on hardware until they are wired up', () => {
    // A Ledger does both, as separate apps with their own protocols. This is
    // false because those transports are not integrated here.
    expect(capabilitiesOf('hardware').otherChains).toBe(false);
  });
});

describe('describeKind', () => {
  it('says how it signs, which is the difference that shows', () => {
    expect(describeKind('hardware')).toContain('device');
    expect(describeKind('phrase')).toContain('recovery phrase');
  });
});

describe('adding a hardware account', () => {
  beforeEach(() => useIdentityStore.setState({ accounts: [], activeAccountId: null }));

  it('stores the address and the vendor, and no secret', async () => {
    await useIdentityStore.getState().addHardwareAccount({
      address: '0x1111111111111111111111111111111111111111',
      vendorId: 'ledger',
      label: 'My Ledger',
    });

    const [record] = useIdentityStore.getState().accounts;
    expect(record.kind).toBe('hardware');
    expect(record.vendorId).toBe('ledger');
    expect(record.label).toBe('My Ledger');
  });

  it('adopts an existing row rather than adding a second for one address', async () => {
    // Two rows sharing an address would fight over one message database, which
    // is also why importing a known phrase adopts the existing row.
    const address = '0x2222222222222222222222222222222222222222' as const;
    await useIdentityStore.getState().addHardwareAccount({ address, vendorId: 'ledger' });
    await useIdentityStore.getState().addHardwareAccount({ address, vendorId: 'ledger' });

    expect(useIdentityStore.getState().accounts).toHaveLength(1);
  });
});
