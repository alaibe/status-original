# On the Mac

The desktop app is the same app in a window: every screen, every network, every
plugin. The layout puts a sidebar of chats beside the open conversation,
the way Telegram for macOS does, and a keyboard and a pointer take over from
taps.

## What changes

- **⌘K** opens the switcher: type a few letters of a chat and press Enter.
- **⌘F** searches messages: inside a chat it searches only that chat.
- **⌘N** starts a new message, **⌘,** opens settings, **⌘1/2/3** switch tabs.
- **Enter** sends; **Shift-Enter** makes a new line.
- **Right-click** a message for what long-press does on the phone.
- **Esc** closes whatever is on top: a sheet, a picker, the emoji panel.
- Settings pages open beside the list rather than over it; new chat, QR and
  profile are centred dialogs.
- The emoji and GIF panel is a popover above the button that opened it, with
  the search already focused, so you can type and press Enter for the first
  match.
- Photos, files and voice notes all work. A photo is compressed before it goes;
  a received file opens in whatever handles its type.
- Sharing means copying to the clipboard. An invite also opens Messages.
- Unread messages show as a badge on the Dock icon.

## Where your data lives

Everything sits under `~/Library/Application Support/com.statusoriginal.app/`:
the encrypted vault holding recovery phrases and keys, one encrypted database
per account, and the Telegram and Matrix data for each account. The vault's key
is in the macOS Keychain.

Erasing an account from Settings removes all of it.

## Hardware wallets

A Ledger connects over USB. Keystone signs by showing and scanning QR codes,
which needs a camera, so use the phone for a Keystone account.
