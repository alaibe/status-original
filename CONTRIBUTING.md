# Contributing

## Before you start

Read `AGENTS.md`. It is short and it applies to people as well as agents: the
Expo docs for the pinned SDK version are the reference, and comments explain
only what the code cannot.

Set up with the steps in `README.md`. A change to native dependencies means
`npx expo prebuild --platform ios` and `npx pod-install` again, since `ios/`
is generated and not committed.

## Checks

Every change should pass all of these before it is opened as a pull request:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e   # needs a booted iOS simulator and Metro
```

`npm run test:all` runs them in that order. The e2e suite drives a debug
build with Maestro; `e2e/README.md` covers the selectors it relies on
(`testID`, never child text of a pressable) and the flows it contains. Add a
flow when a change adds a screen or a command a user reaches by hand.

## Where things go

- Anything a user can type as `/command` is a `SlashCommand` contributed by a
  plugin, or a core command in `src/core/commands`. Core commands get no
  plugin context and must not reach for one.
- Protocol code lives under `src/protocols/<name>` and implements
  `ChatSession`. Local persistence is `src/storage`; do not mix the two.
- UI reads theme tokens through NativeWind classes or `useThemeColors()`.
  Change `src/design/tokens.ts`, then run `npm run theme:build`. Editing
  `src/global.css` by hand is undone on the next build.
- Widgets that appear in chat are data (`src/design/widgets/schema.ts`), not
  components, so a message can be stored, forwarded and rendered by a client
  that has never heard of the plugin that made it. Keep the union additive.

## Generated files

`assets/brand/mark.svg`, everything under `assets/images/`, `store/play/`
and the colour fields in `app.json` come from `npm run brand:build`, which
reads `assets/brand/status-logo-2018.png`. Change the source image, run the
build, and commit what it wrote. Tests fail if the SVG drifts from the image
or if the UI's `brand` token no longer matches the logo's plate colour.

## Patches

`patches/` holds `patch-package` patches for upstream bugs, each documented
in `patches/README.md` with the symptom, the cause, the fix and when to
remove it. Add a new one only with that entry, and prefer removing one over
adding one whenever a dependency update allows.

## Store artifacts

If a change touches onboarding, the chat list, Settings or `app.json`, the
screenshots in `store/screenshots/ios-6.9/` are out of date. Run
`store/screenshots/capture.sh` with Metro up, and re-read
`store/review-notes.md` if the change affects what a reviewer sees.

## Commits and pull requests

Keep a commit to one change and say in the message what it does and why, in
plain sentences. A pull request should say what to look at first and how you
tested it. Uncommitted generated output, a failing check, or a patch without
its README entry will be sent back.

## Security

Do not open a public issue for a vulnerability. Use the repository's private
security advisory on GitHub.
