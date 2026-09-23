export interface KnownBridge {
  network: string;
  localpart: string;
  /** What the bot is sent first; a bare `login` makes it list its sign-in methods. */
  firstCommand: string;
}

/** mautrix bridges under their default bot names, so a homeserver's bridges can be found by profile. */
export const KNOWN_BRIDGES: readonly KnownBridge[] = [
  { network: 'WhatsApp', localpart: 'whatsappbot', firstCommand: 'login qr' },
  { network: 'Signal', localpart: 'signalbot', firstCommand: 'login qr' },
  { network: 'Messenger', localpart: 'facebookbot', firstCommand: 'login messenger-lite' },
  { network: 'Instagram', localpart: 'instagrambot', firstCommand: 'login android' },
  { network: 'Slack', localpart: 'slackbot', firstCommand: 'login token' },
  { network: 'Discord', localpart: 'discordbot', firstCommand: 'login-qr' },
  { network: 'Telegram', localpart: 'telegrambot', firstCommand: 'login' },
  { network: 'Google Messages', localpart: 'gmessagesbot', firstCommand: 'login' },
  { network: 'iMessage', localpart: 'imessagebot', firstCommand: 'login' },
  { network: 'X', localpart: 'twitterbot', firstCommand: 'login' },
  { network: 'Bluesky', localpart: 'blueskybot', firstCommand: 'login' },
  { network: 'LinkedIn', localpart: 'linkedinbot', firstCommand: 'login' },
  { network: 'Google Chat', localpart: 'googlechatbot', firstCommand: 'login' },
  { network: 'Google Voice', localpart: 'gvoicebot', firstCommand: 'login' },
];

export function bridgeBotId(bridge: KnownBridge, selfUserId: string): string {
  return `@${bridge.localpart}:${selfUserId.slice(selfUserId.indexOf(':') + 1)}`;
}
