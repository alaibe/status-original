import { Share } from 'react-native';

import { canOpenExternal, openExternal } from './open-url';

export type ShareResult = 'shared' | 'copied' | 'copied-for-messages';

export async function shareText(message: string): Promise<ShareResult> {
  await Share.share({ message });
  return 'shared';
}

export async function shareWithNumbers(numbers: string[], message: string): Promise<ShareResult> {
  const url = `sms:${numbers.join(',')}&body=${encodeURIComponent(message)}`;
  if (await canOpenExternal(url)) {
    await openExternal(url);
    return 'shared';
  }
  return shareText(message);
}
