import { localpart } from './ids';

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

/** Guessed from mautrix's default names: its bot (`@slackbot`) or its puppets (`@slack_…`). */
export function bridgedNetwork(userIds: (string | null | undefined)[]): string | undefined {
  for (const id of userIds) {
    if (!id) continue;
    const name = localpart(id);
    const bridge =
      knownBridge(name) ?? KNOWN_BRIDGES.find((b) => name.startsWith(`${provisioningName(b)}_`));
    if (bridge) return bridge.network;
  }
  return undefined;
}

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
