# Working in this repository

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before
writing any code. What you remember about Expo, Expo Router or React Native is
probably from an older SDK and probably wrong.

## Comments

Keep comments to the minimum. Add one only when it explains something the code
cannot make clear; never restate the code or add tautological commentary.

## Before you finish

```bash
npm run format && npm run typecheck && npm run lint && npm test
```

Biome formats TypeScript and JSON, rustfmt formats `src-tauri`. Neither lints;
`expo lint` still does that.

## Things that are not obvious from the code

- Generated output is not editable. `src/global.css` comes from
  `src/design/tokens.ts` (`npm run theme:build`); `assets/brand/mark.svg`,
  every icon and store graphic from `assets/brand/status-logo-2018.png`
  (`npm run brand:build`); `ios/` and `android/` from `app.json`
  (`npx expo prebuild`). Editing the output is undone on the next build.
- `.web.ts` / `.web.tsx` is the desktop. There is no browser deployment.
  A platform file must have a non-platform neighbour, and Expo Router needs a
  non-platform file for every route.
- Polyfill order in `index.js` is load-bearing. viem and WalletConnect
  capture `globalThis.crypto` as they evaluate, so `src/polyfills` must run
  before Expo Router builds the route tree.
- Protocols go in `src/protocols/<name>/` and implement `ChatSession`.
  Persistence is `src/storage`. Do not mix the two.
- User-typed `/commands` are `SlashCommand`s contributed by a plugin, or
  core commands in `src/core/commands`. Core commands get no plugin context.
- Chat widgets are data, not components (`src/design/widgets/schema.ts`),
  because a message is stored, forwarded and rendered by clients that may not
  have the plugin that made it. Keep the union additive.
- `patches/` is load-bearing too. Every patch is documented in
  `patches/README.md` with its symptom, cause and removal condition. Add one
  only with that entry.

`CONTRIBUTING.md` has the longer version.
