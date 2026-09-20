import { recoverMessageAddress, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  connectVendor,
  DEFAULT_EVM_PATH,
  hardwareAccount,
  hardwareKeyring,
  registerVendor,
  vendorIds,
} from './hardware';
import { FakeHardwareSigner } from './testing/fake-hardware';

const KEY = `0x${'11'.repeat(32)}` as const;
const signer = () => new FakeHardwareSigner(KEY);

describe('the vendor registry', () => {
  it('connects lazily, so pairing is not attempted at import', async () => {
    let connected = false;
    registerVendor({
      id: 'test-vendor',
      label: 'Test',
      connection: 'bluetooth',
      scan: async () => () => {},
      connect: async () => {
        connected = true;
        return signer();
      },
    });

    // Registering must not open a transport: that would ask for Bluetooth
    // permission on first launch, before anyone chose a wallet.
    expect(connected).toBe(false);
    expect(vendorIds()).toContain('test-vendor');

    await connectVendor('test-vendor', 'device-1');
    expect(connected).toBe(true);
  });

  it('names the vendor it cannot find', async () => {
    await expect(connectVendor('trezor', 'd')).rejects.toThrow(/trezor/);
  });
});

describe('hardwareAccount', () => {
  it('produces a signature the address actually verifies', async () => {
    const device = signer();
    const address = await device.getAddress(DEFAULT_EVM_PATH);
    const account = hardwareAccount(device, address);

    const signature = await account.signMessage({ message: 'hello' });

    expect(await verifyMessage({ address, message: 'hello', signature })).toBe(true);
    expect(await recoverMessageAddress({ message: 'hello', signature })).toBe(address);
  });

  it('matches what a local key would have produced', async () => {
    // The point of the seam: nothing downstream can tell the difference.
    const device = signer();
    const address = await device.getAddress(DEFAULT_EVM_PATH);

    const viaDevice = await hardwareAccount(device, address).signMessage({ message: 'x' });
    const viaKey = await privateKeyToAccount(KEY).signMessage({ message: 'x' });

    expect(viaDevice).toBe(viaKey);
  });

  it('goes to the device rather than signing locally', async () => {
    const device = signer();
    const address = await device.getAddress(DEFAULT_EVM_PATH);

    await hardwareAccount(device, address).signMessage({ message: 'x' });

    expect(device.calls).toContain(`signMessage:${DEFAULT_EVM_PATH}`);
  });

  it('surfaces a refusal instead of swallowing it', async () => {
    // Someone pressing cancel is a normal outcome the app must not hide; the
    // send paths already have to handle a failed signature.
    const device = signer();
    const address = await device.getAddress(DEFAULT_EVM_PATH);
    device.refuse = true;

    await expect(hardwareAccount(device, address).signMessage({ message: 'x' })).rejects.toThrow(
      /Rejected on device/
    );
  });

  it('hands the device the message, not a hash', async () => {
    // Devices apply EIP-191 themselves, because the prefix is part of what
    // they show. One that signed opaque hashes would be a blind-signing
    // machine, which is the thing they exist to prevent.
    const device = signer();
    const address = await device.getAddress(DEFAULT_EVM_PATH);

    await hardwareAccount(device, address).signMessage({ message: 'hello' });

    expect(device.calls).toContain(`signMessage:${DEFAULT_EVM_PATH}`);
    expect(device.calls.some((c) => c.startsWith('signHash'))).toBe(false);
  });
});

describe('hardwareKeyring', () => {
  it('has no phrase to show', async () => {
    const device = signer();
    const keyring = hardwareKeyring(device, await device.getAddress(DEFAULT_EVM_PATH));

    expect(keyring.kind).toBe('hardware');
    expect(keyring.mnemonic).toBeNull();
  });

  it('refuses to derive Bitcoin or Solana, and says why', async () => {
    // Those come from other branches of a phrase, and there is no phrase.
    // Returning something wrong would produce an address nobody can spend.
    const device = signer();
    const keyring = hardwareKeyring(device, await device.getAddress(DEFAULT_EVM_PATH));

    expect(() => keyring.derive("m/84'/0'/0'/0/0")).toThrow(/Bitcoin.*Test device/);
    expect(() => keyring.deriveEd25519("m/44'/501'/0'/0'")).toThrow(/Solana.*Test device/);
  });

  it('still signs for EVM', async () => {
    const device = signer();
    const address = await device.getAddress(DEFAULT_EVM_PATH);
    const keyring = hardwareKeyring(device, address);

    const signature = await keyring.account.signMessage({ message: 'ok' });
    expect(await verifyMessage({ address, message: 'ok', signature })).toBe(true);
  });
});
