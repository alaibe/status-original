const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// WalletConnect, viem and the hardware-wallet SDKs reach for Node core
// modules that React Native does not ship.
//
// `stream` is for Keystone: its UR registry depends on bs58check, which
// depends on create-hash, which is a Node crypto shim from before the platform
// had one. `readable-stream` is that module published standalone, so the shim
// resolves and the whole chain works unchanged.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: require.resolve('expo-crypto'),
  stream: require.resolve('readable-stream'),
};

/**
 * `extraNodeModules` only rewrites requests from this project's own files.
 * The ones that matter come from inside `node_modules` (cipher-base asking
 * for `stream`), and those need the resolver itself.
 */
const NODE_SHIMS = {
  stream: require.resolve('readable-stream'),
  crypto: require.resolve('expo-crypto'),
};

/**
 * These ship a `browser` field that points at files their `exports` map does
 * not list. Metro applies the redirect, then warns that the redirected path is
 * not exported, then falls back to that very file. Resolving them without
 * package exports lands on the same file without the warning. Web keeps the
 * exports map: `uint8arrays/from-string` only exists through it.
 */
const BROWSER_FIELD_OVER_EXPORTS = /^(uint8arrays|multiformats|@noble\/hashes)(\/|$)/;

/**
 * On native, Metro follows Reanimated's `react-native` field to its TypeScript
 * source, so the JSX inside `createAnimatedComponent` is compiled with
 * NativeWind's JSX runtime and `className` reaches the wrapped component. On
 * web, Metro takes the precompiled `main`, which imports `react/jsx-runtime`
 * directly, and every `className` on an animated component is dropped. Giving
 * that one package the same runtime on web restores the native behaviour.
 */
const INTEROP_JSX_ON_WEB = /\/node_modules\/react-native-reanimated\//;

/** See src/desktop/xmtp-wasm-bindings.ts. */
const XMTP_SDK = /\/node_modules\/@xmtp\/browser-sdk\//;
const XMTP_WASM_BINDINGS_ON_WEB = require.resolve('./src/desktop/xmtp-wasm-bindings.ts');

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shim = NODE_SHIMS[moduleName];
  if (shim) return { type: 'sourceFile', filePath: shim };
  if (platform === 'web' && moduleName === '@xmtp/wasm-bindings' && XMTP_SDK.test(context.originModulePath)) {
    return { type: 'sourceFile', filePath: XMTP_WASM_BINDINGS_ON_WEB };
  }
  if (platform === 'web' && moduleName === 'react/jsx-runtime' && INTEROP_JSX_ON_WEB.test(context.originModulePath)) {
    moduleName = 'react-native-css-interop/jsx-runtime';
  }
  if (platform !== 'web' && BROWSER_FIELD_OVER_EXPORTS.test(moduleName)) {
    context = { ...context, unstable_enablePackageExports: false };
  }
  return upstream
    ? upstream(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './src/global.css' });
