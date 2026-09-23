export interface KnownBridge {
  network: string;
  localpart: string;
  firstCommand: string;
  preferredFlow?: string;
}

/** mautrix bridges under their default bot names, so a homeserver's bridges can be found by profile. */
export const KNOWN_BRIDGES: readonly KnownBridge[] = [
  { network: 'WhatsApp', localpart: 'whatsappbot', firstCommand: 'login qr', preferredFlow: 'qr' },
  { network: 'Signal', localpart: 'signalbot', firstCommand: 'login qr', preferredFlow: 'qr' },
  {
    network: 'Messenger',
    localpart: 'facebookbot',
    firstCommand: 'login messenger-lite',
    preferredFlow: 'messenger',
  },
  {
    network: 'Instagram',
    localpart: 'instagrambot',
    firstCommand: 'login instagram-password',
    preferredFlow: 'instagram',
  },
  { network: 'Slack', localpart: 'slackbot', firstCommand: 'login token', preferredFlow: 'token' },
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

/** Where the bridge's login API sits under the homeserver: `/_matrix/provision/<name>/`. */
export function provisioningName(bridge: KnownBridge): string {
  return bridge.localpart.replace(/bot$/, '');
}

export function knownBridge(localpart: string): KnownBridge | undefined {
  return KNOWN_BRIDGES.find((bridge) => bridge.localpart === localpart);
}
