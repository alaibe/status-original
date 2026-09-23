/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  /**
   * react-native-worklets ships this resolver so its `.native.ts` variants —
   * which bind to JSI on import — are skipped under Jest. Without it, any
   * module that transitively touches Reanimated cannot be required in Node,
   * which would put every plugin contributing a component out of test reach.
   */
  resolver: '<rootDir>/node_modules/react-native-worklets/jest/resolver.js',
  /**
   * Agent worktrees live under .claude/ and contain a full copy of this
   * project. Without this, every suite runs once per worktree — inflating the
   * counts and reporting on code that is not in this tree.
   */
  testPathIgnorePatterns: ['/node_modules/', '/.claude/', '<rootDir>/site/'],
  modulePathIgnorePatterns: ['/.claude/', '<rootDir>/site/'],
  // Mirrors the "@/assets/*" and "@/*" aliases from tsconfig.json, in that order.
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Babel under Jest breaks marked's Unicode-property regexes; the UMD build needs no transform.
    '^marked$': '<rootDir>/node_modules/marked/lib/marked.umd.js',
  },
  // These packages ship untranspiled ESM/Flow and must go through Babel.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@xmtp/.*|@scure/.*|@noble/.*|viem|nativewind|react-native-css-interop|@ngraveio/.*|@keystonehq/.*|uuid))',
  ],
};
