/**
 * `babel-preset-expo` already resolves and injects `react-native-worklets/plugin`
 * (Reanimated 4) on its own, so it must not be listed manually here.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
