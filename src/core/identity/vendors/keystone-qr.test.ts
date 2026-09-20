import { UR } from '@ngraveio/bc-ur';
import { ETHSignature } from '@keystonehq/bc-ur-registry-eth';

import { decodeUr, encodeUr, keystoneSigner, readSignatureUr, setQrExchange } from './keystone-qr';

const ACCOUNT = {
  address: '0x1111111111111111111111111111111111111111' as const,
  path: "m/44'/60'/0'/0/0",
  xfp: '12345678',
};

/** A real ETHSignature UR, the way a Keystone answers. */
const signatureUr = (hex: string) =>
  new ETHSignature(Buffer.from(hex, 'hex'), Buffer.from('0'.repeat(32), 'hex')).toUR();

afterEach(() => setQrExchange(null));

describe('UR framing', () => {
  it('round-trips a payload through the frames', () => {
    const ur = signatureUr('ab'.repeat(65));

    const decoded = decodeUr(encodeUr(ur));

    expect(decoded).not.toBeNull();
    expect(decoded?.cbor.equals(ur.cbor)).toBe(true);
  });

  it('splits something too big for one code into several', () => {
    // A transaction does not fit in a single QR. Fountain-encoding it into a
    // loop is the whole reason an air-gapped device is usable at all.
    const big = new UR(Buffer.alloc(2_000, 7), 'bytes');

    expect(encodeUr(big, 100).length).toBeGreaterThan(1);
  });

  it('returns null from an incomplete scan rather than a partial result', () => {
    const parts = encodeUr(new UR(Buffer.alloc(2_000, 7), 'bytes'), 100);

    // Half a signature must never look like a signature.
    expect(decodeUr(parts.slice(0, 1))).toBeNull();
  });
});

describe('readSignatureUr', () => {
  it('reads the 65 bytes back out', () => {
    const hex = 'ab'.repeat(65);
    expect(readSignatureUr(signatureUr(hex))).toBe(`0x${hex}`);
  });
});

describe('keystoneSigner', () => {
  it('refuses to sign when no screen is showing QR codes', async () => {
    // There is no connection to fall back on: without a camera and a screen
    // there is literally no way to reach the device.
    await expect(keystoneSigner(ACCOUNT).signMessage(ACCOUNT.path, 'hi')).rejects.toThrow(
      /Keystone screen/
    );
  });

  it('shows frames and reads the answer back', async () => {
    const hex = 'cd'.repeat(65);
    let shown: { parts: string[]; purpose: string } | null = null;
    setQrExchange(async (request) => {
      shown = request;
      return encodeUr(signatureUr(hex))[0];
    });

    const signature = await keystoneSigner(ACCOUNT).signMessage(ACCOUNT.path, 'hi');

    expect(signature).toBe(`0x${hex}`);
    expect(shown!.purpose).toBe('message');
    expect(shown!.parts.length).toBeGreaterThan(0);
  });

  it('labels what it is asking for, so the prompt can say', async () => {
    const purposes: string[] = [];
    setQrExchange(async (request) => {
      purposes.push(request.purpose);
      return encodeUr(signatureUr('11'.repeat(65)))[0];
    });

    const signer = keystoneSigner(ACCOUNT);
    await signer.signMessage(ACCOUNT.path, 'hi');
    await signer.signTransaction(ACCOUNT.path, '0x02f8');
    await signer.signTypedDataHashes!(ACCOUNT.path, `0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`);

    expect(purposes).toEqual(['message', 'transaction', 'typedData']);
  });

  it('surfaces a walk-away as a failure', async () => {
    setQrExchange(async () => {
      throw new Error('Cancelled');
    });

    await expect(keystoneSigner(ACCOUNT).signMessage(ACCOUNT.path, 'hi')).rejects.toThrow(
      /Cancelled/
    );
  });

  it('rejects a QR that is not a whole signature', async () => {
    setQrExchange(async () => 'ur:bytes/not-a-real-frame');

    await expect(keystoneSigner(ACCOUNT).signMessage(ACCOUNT.path, 'hi')).rejects.toThrow();
  });

  it('knows the address without asking, because it cannot ask', async () => {
    expect(await keystoneSigner(ACCOUNT).getAddress(ACCOUNT.path)).toBe(ACCOUNT.address);
  });
});
