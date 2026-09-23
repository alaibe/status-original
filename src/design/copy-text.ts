import * as Clipboard from 'expo-clipboard';

import { toast } from './toast';

export function copyText(text: string, done = 'Copied'): Promise<void> {
  return Clipboard.setStringAsync(text).then(
    () => void toast.success(done),
    () => void toast.error('Could not copy')
  );
}
