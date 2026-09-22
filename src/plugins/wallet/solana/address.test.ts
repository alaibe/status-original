import { deriveEd25519 } from '@/core/identity/slip10';
import { mnemonicToSeedSync } from '@scure/bip39';

import { formatSol, looksLikeSolanaAddress, solanaAddress, SOLANA_ACCOUNT_PATH } from './address';

const MNEMONIC = 'test test test test test test test test test test test junk';

const key = () => deriveEd25519(mnemonicToSeedSync(MNEMONIC), SOLANA_ACCOUNT_PATH);

describe('solanaAddress', () => {
  it('is base58 of the public key, 32 bytes decoded', () => {
    const address = solanaAddress(key());

    expect(looksLikeSolanaAddress(address)).toBe(true);
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('is the same every time, from the same phrase', () => {
    expect(solanaAddress(key())).toBe(solanaAddress(key()));
  });

  it('uses the path the other Solana wallets use', () => {
    // The value of matching is that the same phrase opens the same account in
    // Phantom or the Solana CLI. Changing this silently strands funds.
    expect(SOLANA_ACCOUNT_PATH).toBe("m/44'/501'/0'/0'");
  });
});

describe('looksLikeSolanaAddress', () => {
  it('rejects an Ethereum address', () => {
    expect(looksLikeSolanaAddress('0x0000000000000000000000000000000000000000')).toBe(false);
  });

  it('rejects the ambiguous base58 characters', () => {
    expect(looksLikeSolanaAddress('0OIl'.repeat(9))).toBe(false);
  });

  it('rejects something the right shape but the wrong length once decoded', () => {
    expect(looksLikeSolanaAddress('1'.repeat(40))).toBe(false);
  });
});

describe('formatSol', () => {
  it('converts lamports without floating point', () => {
    expect(formatSol(1_000_000_000n)).toBe('1');
    expect(formatSol(1_500_000_000n)).toBe('1.5');
    expect(formatSol(1n)).toBe('0.000000001');
    expect(formatSol(0n)).toBe('0');
  });

  it('does not leave a trailing dot or trailing zeros', () => {
    expect(formatSol(2_100_000_000n)).toBe('2.1');
    expect(formatSol(2_000_000_000n)).toBe('2');
  });
});
