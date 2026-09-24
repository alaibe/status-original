export interface CliArg {
  name: string;
  description: string;
  optional?: boolean;
  variadic?: boolean;
}

export interface CliFlag {
  name: string;
  description: string;
  /** Placeholder for the value; a flag without one is a switch. */
  value?: string;
}

export type CliGroup =
  | 'App'
  | 'Accounts'
  | 'Networks'
  | 'Chats'
  | 'Messages'
  | 'Groups'
  | 'People'
  | 'Settings'
  | 'Plugins'
  | 'Live';

export interface CliCommandSpec {
  path: string;
  group: CliGroup;
  summary: string;
  args?: readonly CliArg[];
  flags?: readonly CliFlag[];
  examples?: readonly string[];
  /** Asks the person at the app before it runs; the reason is shown to them. */
  approval?: boolean;
  /** Options it does not know are passed on as arguments, for a slash command's own flags. */
  passthrough?: boolean;
}

const chat: CliArg = { name: 'chat', description: 'Chat id, or a unique part of its title' };
const message: CliArg = { name: 'message', description: 'Message id, or `last`' };
const network: CliFlag = {
  name: 'network',
  value: 'id',
  description: 'Network to use (see `networks`)',
};
const limit: CliFlag = { name: 'limit', value: 'n', description: 'How many to show' };

export const COMMANDS = [
  {
    path: 'status',
    group: 'App',
    summary: 'Show whether the app is unlocked, the active account and each network',
  },
  {
    path: 'open',
    group: 'App',
    summary: 'Bring the app window forward, optionally on a chat',
    args: [{ ...chat, optional: true }],
  },
  {
    path: 'quit',
    group: 'App',
    summary: 'Quit the app',
  },
  {
    path: 'accounts',
    group: 'Accounts',
    summary: 'List accounts on this device',
  },
  {
    path: 'accounts use',
    group: 'Accounts',
    summary: 'Switch the active account',
    args: [{ name: 'account', description: 'Account id, label or address' }],
  },
  {
    path: 'accounts rename',
    group: 'Accounts',
    summary: 'Rename an account',
    args: [
      { name: 'account', description: 'Account id, label or address' },
      { name: 'label', description: 'New name', variadic: true },
    ],
  },
  {
    path: 'accounts create',
    group: 'Accounts',
    summary: 'Create a new account; back up its recovery phrase in the app',
    flags: [{ name: 'label', value: 'name', description: 'Name for the account' }],
  },
  {
    path: 'accounts import',
    group: 'Accounts',
    summary: 'Import an account from a recovery phrase read from stdin or a hidden prompt',
    flags: [{ name: 'label', value: 'name', description: 'Name for the account' }],
    examples: ['status-original accounts import --label Work < phrase.txt'],
  },
  {
    path: 'accounts erase',
    group: 'Accounts',
    summary: 'Erase an account and everything stored for it on this device',
    args: [{ name: 'account', description: 'Account id, label or address' }],
    approval: true,
  },
  {
    path: 'whoami',
    group: 'Accounts',
    summary: 'Show the active account and your id on each network',
  },
  {
    path: 'networks',
    group: 'Networks',
    summary: 'List networks with their connection state',
  },
  {
    path: 'networks config',
    group: 'Networks',
    summary: 'Show or change a network’s settings; secret fields are prompted for',
    args: [
      { name: 'network', description: 'Network id' },
      { name: 'key=value', description: 'Settings to change', optional: true, variadic: true },
    ],
    examples: [
      'status-original networks config matrix homeserver=https://matrix.org username=alice',
    ],
  },
  {
    path: 'networks login',
    group: 'Networks',
    summary:
      'Sign in to a network that asks for a phone number, code or password. At a terminal it prompts; otherwise give one answer at a time and it prints the next step',
    args: [
      { name: 'network', description: 'Network id' },
      { name: 'answer', description: 'Answer to the step it is waiting on', optional: true },
    ],
    examples: [
      'status-original networks login telegram',
      'status-original networks login telegram +447700900123 --json',
    ],
  },
  {
    path: 'networks logout',
    group: 'Networks',
    summary: 'Sign out of a network',
    args: [{ name: 'network', description: 'Network id' }],
    approval: true,
  },
  {
    path: 'networks sync',
    group: 'Networks',
    summary: 'Fetch what is new from every network, or one',
    args: [{ name: 'network', description: 'Network id', optional: true }],
  },
  {
    path: 'devices',
    group: 'Networks',
    summary: 'List the XMTP installations of this account',
  },
  {
    path: 'devices revoke',
    group: 'Networks',
    summary: 'Revoke XMTP installations other than this one',
    args: [{ name: 'installation', description: 'Installation ids', variadic: true }],
    approval: true,
  },
  {
    path: 'chats',
    group: 'Chats',
    summary: 'List chats, newest first',
    flags: [
      { name: 'unread', description: 'Only unread chats' },
      { name: 'mentions', description: 'Only chats with unread mentions' },
      { name: 'dms', description: 'Only direct messages' },
      { name: 'groups', description: 'Only groups and channels' },
      { name: 'archived', description: 'Only archived chats' },
      { name: 'requests', description: 'Only message requests' },
      network,
      limit,
    ],
  },
  {
    path: 'chat',
    group: 'Chats',
    summary: 'Show one chat: kind, network, members, unread, description and link',
    args: [chat],
  },
  {
    path: 'read',
    group: 'Chats',
    summary: 'Print a chat’s messages, oldest first',
    args: [chat],
    flags: [
      { name: 'limit', value: 'n', description: 'How many of the latest messages (default 20)' },
      { name: 'before', value: 'message', description: 'Only messages older than this one' },
      { name: 'mark-read', description: 'Also mark the chat as read' },
    ],
  },
  {
    path: 'search',
    group: 'Chats',
    summary: 'Search messages across chats, or in one',
    args: [{ name: 'query', description: 'Words to look for', variadic: true }],
    flags: [{ name: 'in', value: 'chat', description: 'Search only this chat' }],
  },
  {
    path: 'mark-read',
    group: 'Chats',
    summary: 'Mark a chat as read',
    args: [chat],
  },
  {
    path: 'mark-unread',
    group: 'Chats',
    summary: 'Mark a chat as unread',
    args: [chat],
  },
  {
    path: 'accept',
    group: 'Chats',
    summary: 'Accept a message request',
    args: [chat],
  },
  {
    path: 'block',
    group: 'Chats',
    summary: 'Decline a message request, or block a chat',
    args: [chat],
  },
  {
    path: 'pin',
    group: 'Chats',
    summary: 'Pin a chat to the top of the list',
    args: [chat],
  },
  {
    path: 'unpin',
    group: 'Chats',
    summary: 'Unpin a chat',
    args: [chat],
  },
  {
    path: 'mute',
    group: 'Chats',
    summary: 'Mute a chat',
    args: [chat],
  },
  {
    path: 'unmute',
    group: 'Chats',
    summary: 'Unmute a chat',
    args: [chat],
  },
  {
    path: 'archive',
    group: 'Chats',
    summary: 'Archive a chat',
    args: [chat],
  },
  {
    path: 'unarchive',
    group: 'Chats',
    summary: 'Move a chat out of the archive',
    args: [chat],
  },
  {
    path: 'draft',
    group: 'Chats',
    summary: 'Show a chat’s draft, or replace it',
    args: [
      chat,
      { name: 'text', description: 'New draft; empty clears it', optional: true, variadic: true },
    ],
  },
  {
    path: 'send',
    group: 'Messages',
    summary: 'Send a message; `-` or no text reads it from stdin',
    args: [chat, { name: 'text', description: 'Message text', optional: true, variadic: true }],
    flags: [
      { name: 'file', value: 'path', description: 'Attach a file; `-` reads it from stdin' },
      { name: 'name', value: 'filename', description: 'File name when the file comes from stdin' },
      { name: 'reply', value: 'message', description: 'Reply to this message' },
    ],
    examples: [
      'status-original send "Alice" "on my way"',
      'git log -1 | status-original send dev-team -',
      'status-original send alice --file ./photo.jpg "from the trip"',
    ],
  },
  {
    path: 'edit',
    group: 'Messages',
    summary: 'Edit one of your messages',
    args: [chat, message, { name: 'text', description: 'New text', variadic: true }],
  },
  {
    path: 'delete',
    group: 'Messages',
    summary: 'Delete a message for everyone, or only for you',
    args: [chat, message],
    flags: [{ name: 'for-me', description: 'Delete it only on your side' }],
  },
  {
    path: 'react',
    group: 'Messages',
    summary: 'Add or remove a reaction',
    args: [chat, message, { name: 'emoji', description: 'The reaction, e.g. 👍' }],
  },
  {
    path: 'forward',
    group: 'Messages',
    summary: 'Forward a message to another chat',
    args: [chat, message, { name: 'to', description: 'Destination chat' }],
  },
  {
    path: 'retry',
    group: 'Messages',
    summary: 'Resend a message that failed',
    args: [chat, message],
  },
  {
    path: 'pins',
    group: 'Messages',
    summary: 'List a chat’s pinned messages',
    args: [chat],
  },
  {
    path: 'pin-message',
    group: 'Messages',
    summary: 'Pin a message in a chat',
    args: [chat, message],
  },
  {
    path: 'unpin-message',
    group: 'Messages',
    summary: 'Unpin a message',
    args: [chat, message],
  },
  {
    path: 'poll create',
    group: 'Messages',
    summary: 'Post a poll',
    args: [
      chat,
      { name: 'question', description: 'The question' },
      { name: 'option', description: 'At least two answers', variadic: true },
    ],
    examples: ['status-original poll create team "Lunch?" Pizza Sushi Salad'],
  },
  {
    path: 'poll vote',
    group: 'Messages',
    summary: 'Vote in a poll by option number, starting at 1',
    args: [chat, message, { name: 'option', description: 'Option numbers', variadic: true }],
  },
  {
    path: 'download',
    group: 'Messages',
    summary: 'Save a message’s photo, file, voice note or video',
    args: [chat, message],
    flags: [
      { name: 'out', value: 'path', description: 'Where to write it (default: its name, here)' },
    ],
  },
  {
    path: 'new',
    group: 'People',
    summary: 'Start a direct message; the peer can be an address, ENS name, username or link',
    args: [{ name: 'peer', description: 'Who to message' }],
    flags: [network],
    examples: ['status-original new vitalik.eth', 'status-original new @durov --network telegram'],
  },
  {
    path: 'resolve',
    group: 'People',
    summary: 'Find the id a network uses for an address, name or link',
    args: [{ name: 'peer', description: 'Address, ENS name, username or link' }],
    flags: [network],
  },
  {
    path: 'contacts',
    group: 'People',
    summary: 'List the people you have direct messages with',
    flags: [network],
  },
  {
    path: 'group create',
    group: 'Groups',
    summary: 'Create a group',
    args: [
      { name: 'title', description: 'Group name' },
      { name: 'peer', description: 'Members to add', variadic: true },
    ],
    flags: [network],
  },
  {
    path: 'group members',
    group: 'Groups',
    summary: 'List a group’s members and their roles',
    args: [chat],
  },
  {
    path: 'group add',
    group: 'Groups',
    summary: 'Add members',
    args: [chat, { name: 'peer', description: 'Members to add', variadic: true }],
  },
  {
    path: 'group remove',
    group: 'Groups',
    summary: 'Remove members',
    args: [chat, { name: 'member', description: 'Member ids', variadic: true }],
  },
  {
    path: 'group ban',
    group: 'Groups',
    summary: 'Ban a member',
    args: [chat, { name: 'member', description: 'Member id' }],
  },
  {
    path: 'group mute',
    group: 'Groups',
    summary: 'Stop a member from sending',
    args: [chat, { name: 'member', description: 'Member id' }],
  },
  {
    path: 'group unmute',
    group: 'Groups',
    summary: 'Let a muted member send again',
    args: [chat, { name: 'member', description: 'Member id' }],
  },
  {
    path: 'group rename',
    group: 'Groups',
    summary: 'Rename a group',
    args: [chat, { name: 'title', description: 'New name', variadic: true }],
  },
  {
    path: 'group leave',
    group: 'Groups',
    summary: 'Leave a group',
    args: [chat],
  },
  {
    path: 'group slowmode',
    group: 'Groups',
    summary: 'Set the minimum seconds between one member’s messages (0 turns it off)',
    args: [chat, { name: 'seconds', description: 'Delay in seconds' }],
  },
  {
    path: 'group invite-link',
    group: 'Groups',
    summary: 'Create an invite link',
    args: [chat],
    flags: [{ name: 'approval', description: 'People who use it must be approved' }],
  },
  {
    path: 'group requests',
    group: 'Groups',
    summary: 'List pending join requests',
    args: [chat],
  },
  {
    path: 'group approve',
    group: 'Groups',
    summary: 'Approve a join request',
    args: [chat, { name: 'user', description: 'Requester id' }],
  },
  {
    path: 'group decline',
    group: 'Groups',
    summary: 'Decline a join request',
    args: [chat, { name: 'user', description: 'Requester id' }],
  },
  {
    path: 'join',
    group: 'Groups',
    summary: 'Preview and join a public group or channel by username or link',
    args: [{ name: 'link', description: 'Username or link' }],
    flags: [network, { name: 'preview', description: 'Only show what you would join' }],
  },
  {
    path: 'settings',
    group: 'Settings',
    summary: 'Show appearance and privacy settings',
  },
  {
    path: 'settings set',
    group: 'Settings',
    summary: 'Change a setting',
    args: [
      {
        name: 'setting',
        description: 'theme, wallpaper, read-receipts, typing-indicators or link-previews',
      },
      { name: 'value', description: 'For switches: on or off' },
    ],
    examples: [
      'status-original settings set theme dark',
      'status-original settings set read-receipts off',
    ],
  },
  {
    path: 'apikey',
    group: 'Settings',
    summary:
      'Save an API key (gifs or trades), read from stdin or a hidden prompt; empty removes it',
    args: [{ name: 'service', description: 'gifs or trades' }],
  },
  {
    path: 'plugins',
    group: 'Plugins',
    summary: 'List plugins and whether they are on',
  },
  {
    path: 'plugins enable',
    group: 'Plugins',
    summary: 'Turn a plugin on, granting its permissions',
    args: [{ name: 'plugin', description: 'Plugin id' }],
    approval: true,
  },
  {
    path: 'plugins disable',
    group: 'Plugins',
    summary: 'Turn a plugin off',
    args: [{ name: 'plugin', description: 'Plugin id' }],
  },
  {
    path: 'commands',
    group: 'Plugins',
    summary: 'List the slash commands plugins offer, everywhere or in one chat',
    args: [{ ...chat, optional: true }],
  },
  {
    path: 'run',
    group: 'Plugins',
    summary:
      'Run a plugin slash command; with no chat it runs in the chat of the plugin that owns it. Anything that signs asks you in the app first',
    args: [
      { ...chat, optional: true },
      { name: 'command', description: 'The command, starting with /', variadic: true },
    ],
    examples: [
      'status-original run /balance',
      'status-original run /price eth',
      'status-original run alice /send 0.01 ETH',
    ],
    passthrough: true,
  },
  {
    path: 'link',
    group: 'Plugins',
    summary: 'Open a link a plugin handles, such as a WalletConnect wc: pairing link',
    args: [{ name: 'uri', description: 'The link' }],
  },
  {
    path: 'watch',
    group: 'Live',
    summary: 'Print new messages as they arrive, one JSON object per line with --json',
    flags: [{ name: 'in', value: 'chat', description: 'Only this chat' }],
  },
] as const satisfies readonly CliCommandSpec[];

export type CommandPath = (typeof COMMANDS)[number]['path'];

export const GLOBAL_FLAGS: readonly CliFlag[] = [
  { name: 'json', description: 'Print machine-readable JSON' },
  { name: 'help', description: 'Explain a command' },
];

export const EXIT_CODES = {
  ok: 0,
  failed: 1,
  usage: 2,
  notFound: 3,
  unavailable: 4,
  denied: 5,
  unsupported: 6,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const EXIT_MEANINGS: Record<ExitCode, string> = {
  0: 'Done',
  1: 'The network or the app refused, or something failed; the message says why',
  2: 'Wrong arguments; run the command with --help',
  3: 'No chat, message, account or network matches, or more than one does',
  4: 'The command line is turned off in the app, the app is locked, it has no account, or the network is not connected',
  5: 'You declined the request in the app',
  6: 'That network cannot do this',
};
