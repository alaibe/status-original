import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

import { BIP84_ACCOUNT_PATH, isBitcoinAddress, p2wpkhAddress } from './address';

/** The mnemonic used by the BIP-84 spec's test vectors. */
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function keyAt(path: string) {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC)).derive(path);
  return node.publicKey!;
}

describe('p2wpkhAddress', () => {
  it('matches the BIP-84 test vector for the first receiving address', () => {
    expect(p2wpkhAddress(keyAt(BIP84_ACCOUNT_PATH))).toBe(
      'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
    );
  });

  it('matches the vector for the second receiving address', () => {
    expect(p2wpkhAddress(keyAt("m/84'/0'/0'/0/1"))).toBe(
      'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'
    );
  });

  it('uses the testnet prefix when asked', () => {
    expect(p2wpkhAddress(keyAt(BIP84_ACCOUNT_PATH), 'testnet')).toMatch(/^tb1/);
  });

  it('rejects an uncompressed key rather than producing a wrong address', () => {
    expect(() => p2wpkhAddress(new Uint8Array(65))).toThrow(/33-byte compressed/);
  });
});

describe('isBitcoinAddress', () => {
  it('accepts bech32 and legacy forms', () => {
    expect(isBitcoinAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBe(true);
    expect(isBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
  });

  it('rejects an Ethereum address', () => {
    expect(isBitcoinAddress('0x0000000000000000000000000000000000000000')).toBe(false);
  });
});
