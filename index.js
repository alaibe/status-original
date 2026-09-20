/**
 * Custom entry point.
 *
 * Polyfills must be installed before expo-router builds its route tree:
 * requiring the route modules pulls in viem and WalletConnect, which capture
 * `globalThis.crypto` as they evaluate. See src/polyfills/crypto.ts.
 */
import './src/polyfills';

import 'expo-router/entry';
