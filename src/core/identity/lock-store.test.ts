import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

import { isLockEnabled, setLockEnabled } from './lock';
import { RELOCK_AFTER_MS, useLockStore } from './lock-store';
import { VaultKey } from '@/storage/vault';

const authenticateAsync = LocalAuthentication.authenticateAsync as jest.MockedFunction<
  typeof LocalAuthentication.authenticateAsync
>;

beforeEach(() => {
  (SecureStore as unknown as { __reset(): void }).__reset();
  authenticateAsync.mockReset();
  authenticateAsync.mockResolvedValue({ success: true } as never);
  useLockStore.setState({ status: 'checking', prompting: false, backgroundedAt: null });
});

describe('arming the lock', () => {
  it('requires passing the prompt first', async () => {
    // Otherwise a user whose enrolled biometric does not actually work only
    // finds out on next launch, locked out of the app holding their phrase.
    authenticateAsync.mockResolvedValue({ success: false } as never);

    expect(await setLockEnabled(true)).toBe(false);
    expect(await isLockEnabled()).toBe(false);
  });

  it('persists once the prompt passes', async () => {
    expect(await setLockEnabled(true)).toBe(true);
    expect(await isLockEnabled()).toBe(true);
  });

  it('disarms without prompting', async () => {
    await setLockEnabled(true);
    authenticateAsync.mockClear();

    expect(await setLockEnabled(false)).toBe(true);
    expect(await isLockEnabled()).toBe(false);
    expect(authenticateAsync).not.toHaveBeenCalled();
  });
});

describe('evaluate', () => {
  it('opens straight through when the lock is not armed', async () => {
    await useLockStore.getState().evaluate();
    expect(useLockStore.getState().status).toBe('open');
  });

  it('locks when armed', async () => {
    await SecureStore.setItemAsync(VaultKey.biometricLock, '1');
    await useLockStore.getState().evaluate();
    expect(useLockStore.getState().status).toBe('locked');
  });
});

describe('unlock', () => {
  it('opens on a successful prompt', async () => {
    await SecureStore.setItemAsync(VaultKey.biometricLock, '1');
    await useLockStore.getState().evaluate();

    expect(await useLockStore.getState().unlock()).toBe(true);
    expect(useLockStore.getState().status).toBe('open');
  });

  it('stays locked when the prompt is refused', async () => {
    authenticateAsync.mockResolvedValue({ success: false } as never);
    await SecureStore.setItemAsync(VaultKey.biometricLock, '1');
    await useLockStore.getState().evaluate();

    expect(await useLockStore.getState().unlock()).toBe(false);
    expect(useLockStore.getState().status).toBe('locked');
  });

  it('refuses to stack a second prompt', async () => {
    // iOS cancels both when two prompts race, which reads to the user as
    // biometrics being broken.
    useLockStore.setState({ status: 'locked', prompting: true });

    expect(await useLockStore.getState().unlock()).toBe(false);
    expect(authenticateAsync).not.toHaveBeenCalled();
  });
});

describe('backgrounding', () => {
  it('re-locks after a long spell away', async () => {
    await SecureStore.setItemAsync(VaultKey.biometricLock, '1');
    useLockStore.setState({ status: 'open' });

    useLockStore.getState().noteBackgrounded();
    useLockStore.setState({ backgroundedAt: Date.now() - RELOCK_AFTER_MS - 1 });
    await useLockStore.getState().noteForegrounded();

    expect(useLockStore.getState().status).toBe('locked');
  });

  it('stays open after a brief switch away', async () => {
    await SecureStore.setItemAsync(VaultKey.biometricLock, '1');
    useLockStore.setState({ status: 'open' });

    useLockStore.getState().noteBackgrounded();
    await useLockStore.getState().noteForegrounded();

    expect(useLockStore.getState().status).toBe('open');
  });

  it('never re-locks when the lock is disarmed', async () => {
    useLockStore.setState({ status: 'open' });
    useLockStore.getState().noteBackgrounded();
    useLockStore.setState({ backgroundedAt: Date.now() - RELOCK_AFTER_MS - 1 });

    await useLockStore.getState().noteForegrounded();

    expect(useLockStore.getState().status).toBe('open');
  });
});

describe('noteJustAuthenticated', () => {
  it('opens the gate without a second prompt', async () => {
    // Arming the lock in settings already required passing it. Re-evaluating
    // would lock the user out of the screen they are standing on.
    await SecureStore.setItemAsync(VaultKey.biometricLock, '1');
    useLockStore.setState({ status: 'checking' });

    useLockStore.getState().noteJustAuthenticated();

    expect(useLockStore.getState().status).toBe('open');
    expect(authenticateAsync).not.toHaveBeenCalled();
  });
});
