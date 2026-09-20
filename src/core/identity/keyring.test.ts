import { isValidMnemonic, keyringFromMnemonic, normalizeMnemonic, shortAddress } from './keyring';

/**
 * Vectors from the BIP-39 spec / Trezor test suite, with the Ethereum address
 * at the standard path m/44'/60'/0'/0/x. These pin down the exact derivation
 * the identity depends on: if this changes, every existing account breaks.
 */
const VECTOR = {
  mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
  address0: '0x58A57ed9d8d624cBD12e2C467D34787555bB1b25',
  address1: '0x9C4e6D6cd94b6a9d3F42fa9dF7Dbdb1cfCB9bD9F',
};

describe('keyringFromMnemonic', () => {
  it('derives the documented address for a known phrase', () => {
    const keyring = keyringFromMnemonic(VECTOR.mnemonic);
    expect(keyring.address).toBe(VECTOR.address0);
  });

  it('is deterministic', () => {
    const a = keyringFromMnemonic(VECTOR.mnemonic);
    const b = keyringFromMnemonic(VECTOR.mnemonic);
    expect(a.address).toBe(b.address);
  });

  it('walks the address index for extra accounts', () => {
    const second = keyringFromMnemonic(VECTOR.mnemonic, 1);
    expect(second.address).not.toBe(VECTOR.address0);
  });

  it('tolerates messy user input', () => {
    const messy = `  LEGAL Winner  thank\nyear wave sausage worth useful legal winner thank yellow `;
    expect(normalizeMnemonic(messy)).toBe(VECTOR.mnemonic);
    expect(keyringFromMnemonic(messy).address).toBe(VECTOR.address0);
  });

  it('exposes a signing account for the XMTP signer', () => {
    // The adapter builds XMTP's Signer from this account rather than a viem
    // WalletClient: Client.create hands the unconverted value to its signature
    // handler, which calls signMessage(string), a shape WalletClient rejects.
    const { account } = keyringFromMnemonic(VECTOR.mnemonic);
    expect(account.address).toBe(VECTOR.address0);
    expect(typeof account.signMessage).toBe('function');
  });
});

describe('isValidMnemonic', () => {
  it('accepts a valid phrase', () => {
    expect(isValidMnemonic(VECTOR.mnemonic)).toBe(true);
  });

  it('rejects a bad checksum', () => {
    // Same words, last one swapped: valid wordlist entries, invalid checksum.
    expect(
      isValidMnemonic('legal winner thank year wave sausage worth useful legal winner thank zoo')
    ).toBe(false);
  });

  it('rejects nonsense and wrong lengths', () => {
    expect(isValidMnemonic('not actually a real recovery phrase at all')).toBe(false);
    expect(isValidMnemonic('')).toBe(false);
  });
});

describe('shortAddress', () => {
  it('elides the middle', () => {
    expect(shortAddress(VECTOR.address0)).toBe('0x58A5…1b25');
  });

  it('leaves short strings alone', () => {
    expect(shortAddress('0xabc')).toBe('0xabc');
  });
});

describe('derive', () => {
  it('matches the BIP-84 test vector for the first native-segwit key', () => {
    // From the BIP-84 spec's "Test vectors" section, m/84'/0'/0'/0/0.
    const { derive } = keyringFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );
    const key = derive("m/84'/0'/0'/0/0");

    expect(Buffer.from(key.publicKey).toString('hex')).toBe(
      '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c'
    );
    expect(key.privateKey).toHaveLength(32);
  });

  it('gives different keys for different paths', () => {
    const { derive } = keyringFromMnemonic(VECTOR.mnemonic);
    const a = derive("m/84'/0'/0'/0/0");
    const b = derive("m/84'/0'/0'/0/1");
    expect(Buffer.from(a.privateKey)).not.toEqual(Buffer.from(b.privateKey));
  });
});
