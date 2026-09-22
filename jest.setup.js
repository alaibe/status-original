// AsyncStorage is a native module; the package ships an in-memory mock for tests.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

/**
 * The keychain, in memory.
 *
 * Identity, the account registry and per-account key isolation are exactly the
 * logic worth testing, and all of it goes through SecureStore. Without a
 * double the native module returns undefined and every read looks like "no
 * account on this device".
 *
 * Items are namespaced by `keychainService` because biometric-sealed values
 * live under their own service, and the two must not be able to read each
 * other. `__invalidateProtected` and `__denyProtected` model the two ways a
 * sealed read fails on a real device (the system discarding the key when
 * biometrics change, and the user refusing the prompt), neither of which a
 * simulator will ever produce on its own.
 */
jest.mock('expo-secure-store', () => {
  const stores = new Map();
  let denyProtected = false;

  const bucket = (options) => {
    const service = options?.keychainService ?? 'default';
    if (!stores.has(service)) stores.set(service, new Map());
    return stores.get(service);
  };
  const isProtected = (options) => options?.requireAuthentication === true;

  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
    WHEN_UNLOCKED: 'whenUnlocked',
    getItemAsync: async (key, options) => {
      if (isProtected(options) && denyProtected) throw new Error('User canceled');
      const store = bucket(options);
      return store.has(key) ? store.get(key) : null;
    },
    setItemAsync: async (key, value, options) => void bucket(options).set(key, value),
    deleteItemAsync: async (key, options) => void bucket(options).delete(key),

    __reset: () => {
      stores.clear();
      denyProtected = false;
    },
    /** Simulates iOS discarding sealed items after a biometric change. */
    __invalidateProtected: () => {
      for (const [service, store] of stores) {
        if (service !== 'default') store.clear();
      }
    },
    /** Simulates the user refusing, or failing, the biometric prompt. */
    __denyProtected: (value) => {
      denyProtected = value;
    },
  };
});

jest.mock('expo-crypto', () => ({
  getRandomBytes: (size) => {
    // Deterministic but distinct per call, so generated ids do not collide
    // within a test the way a constant fill would.
    let seed = (globalThis.__cryptoSeed = (globalThis.__cryptoSeed ?? 0) + 1);
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[i] = seed & 0xff;
    }
    return out;
  },
}));

// jest.fn() rather than plain functions: the lock's whole contract is what it
// does when the OS prompt succeeds, fails, or is cancelled, so tests need to
// drive those outcomes.
jest.mock('expo-local-authentication', () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [2]),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

/**
 * Navigation, for the handful of core commands that push a screen.
 *
 * `/profile` opens the profile route through the imperative router: it is a
 * core command, so it has no plugin context to go through. Importing the real
 * expo-router into a Node test pulls the whole navigator, which is neither
 * transformable nor the thing under test; what matters here is that the
 * command runs and asks for the right route.
 */
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

/**
 * SQLite, on Node's own engine.
 *
 * `expo-sqlite` is a native module, so without this the message store, which
 * holds every Waku and Nostr message, could not be tested at all. See
 * src/storage/testing/expo-sqlite-mock.js for what this does and does
 * not cover (it is a real SQLite; it is not SQLCipher).
 */
jest.mock('expo-sqlite', () => require('./src/storage/testing/expo-sqlite-mock'));
