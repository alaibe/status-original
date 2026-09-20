import { hexToBytes } from '@noble/hashes/utils.js';

import { deriveEd25519 } from './slip10';

/** SLIP-0010 test vector 1, ed25519. */
const SEED = hexToBytes('000102030405060708090a0b0c0d0e0f');

describe('deriveEd25519', () => {
  it('matches the SLIP-0010 vector at the master node', () => {
    const key = deriveEd25519(SEED, 'm');

    expect(Buffer.from(key.privateKey).toString('hex')).toBe(
      '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7'
    );
  });

  it("matches the SLIP-0010 vector at m/0'", () => {
    const key = deriveEd25519(SEED, "m/0'");

    expect(Buffer.from(key.privateKey).toString('hex')).toBe(
      '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3'
    );
  });

  it('refuses an unhardened segment instead of quietly hardening it', () => {
    // The curve cannot do unhardened derivation at all. Hardening it silently
    // would hand back a different key than the path names, which for an
    // address someone funds is the worst possible kind of wrong.
    expect(() => deriveEd25519(SEED, "m/44'/501'/0'/0")).toThrow(/hardened-only/);
  });

  it('rejects a path that does not start at the master node', () => {
    expect(() => deriveEd25519(SEED, "44'/501'")).toThrow(/must start/);
  });

  it('is deterministic, and separates paths', () => {
    const a = deriveEd25519(SEED, "m/44'/501'/0'/0'");
    const b = deriveEd25519(SEED, "m/44'/501'/0'/0'");
    const c = deriveEd25519(SEED, "m/44'/501'/1'/0'");

    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.publicKey).not.toEqual(c.publicKey);
    expect(a.publicKey).toHaveLength(32);
  });
});
