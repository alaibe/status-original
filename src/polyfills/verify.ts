import { randomBytes } from '@noble/hashes/utils.js';

if (__DEV__) {
  try {
    randomBytes(1);
  } catch (cause) {
    throw new Error(
      'Crypto polyfill did not install before @noble/hashes was evaluated. ' +
        'Check that index.js imports ./src/polyfills before expo-router/entry.',
      { cause }
    );
  }
}
