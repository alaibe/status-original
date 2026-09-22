# On the Mac

The desktop app is the same app in a window: every screen, network and
plugin. The layout puts a sidebar of chats beside the open conversation, the
way Telegram for macOS does, and a keyboard and a pointer replace taps.

- **⌘K** opens the switcher: type a few letters of a chat and press Enter.
- **Enter** sends; **Shift-Enter** makes a new line.
- **Right-click** a message for what long-press does on the phone.
- **Esc** closes whatever is on top: a sheet, a picker, the emoji panel.
- Settings pages open beside the list rather than over it; dialogs are
  centred.
- Photos, files and voice notes work; a photo is compressed before it goes,
  a received file opens in whatever handles its type.
- Sharing means copying to the clipboard; an invite also opens Messages.
- Unread messages show as a badge on the dock icon.

## Where your data lives

Everything is under `~/Library/Application Support/com.statusoriginal.app/`:
the encrypted vault that holds recovery phrases and keys, one encrypted
database per account, and the Telegram and Matrix data for each account. The
vault's key is in the macOS Keychain. Erasing an account from Settings removes
all of it.

## Hardware wallets

A Ledger connects over USB on the Mac. Keystone signs by showing and scanning
QR codes, which needs a camera, so use the phone for a Keystone account.
