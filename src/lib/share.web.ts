import * as Clipboard from 'expo-clipboard';

import { openExternal } from './open-url';

export type ShareResult = 'shared' | 'copied' | 'copied-for-messages';

// The desktop has no share sheet; the clipboard is the nearest thing.
export async function shareText(message: string): Promise<ShareResult> {
  await Clipboard.setStringAsync(message);
  return 'copied';
}

// Messages on the Mac takes the recipients from the link but not a body.
export async function shareWithNumbers(numbers: string[], message: string): Promise<ShareResult> {
  await Clipboard.setStringAsync(message);
  const opened = await openExternal(`sms:${numbers.join(',')}`)
    .then(() => true)
    .catch(() => false);
  return opened ? 'copied-for-messages' : 'copied';
}
