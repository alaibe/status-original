# App Store submission artifacts

| File | Goes into |
|---|---|
| `store.config.json` | EAS Metadata → App Store Connect listing (`eas metadata:push`) |
| `screenshots/ios-6.9/` | App Store Connect → Media Manager, iPhone 6.9" |
| `screenshots/capture.sh` | regenerates them: erases a simulator, installs the build, runs the flow |
| `screenshots/capture.yaml` | the Maestro flow the screenshots come from |
| `play/icon.png`, `play/feature-graphic.png` | Google Play listing graphics, from `npm run brand:build` |
| `review-notes.md` | App Review Information → Notes |
| `privacy-labels.md` | App Privacy questionnaire |
| `export-compliance.md` | the encryption question asked on every upload |

The screenshots are `01-welcome`, `02-chats`, `03-conversation`, `04-note`,
`05-message-actions` and `06-plugins`. Regenerate them with
`screenshots/capture.sh` after any change to onboarding, the chat list,
Settings or `app.json`, and before every submission. The text limits and the
rest of the pre-flight checks are in `.claude/skills/store-artifacts/SKILL.md`,
which is written as a runbook and reads fine as one.

## Before submitting

Cryptocurrency wallet apps must come from an organization account (guideline
3.1.5(b)). Check the enrollment type before building; changing it takes weeks.

Export compliance is answered `true` in `app.json`, because the app ships
non-exempt encryption. App Store Connect will ask for a self-classification
report or a CCATS on the first upload. See `export-compliance.md`.

`expo-observe` uploads performance data, including the host of the slowest
request made during launch. It is declared as Performance Data in the privacy
manifest and in the App Privacy answers. If it is ever removed, change both.
See `privacy-labels.md`.

The reviewer contact in `store.config.json` is a placeholder on purpose. It is
personal and this repository is public. Enter it in App Store Connect.
