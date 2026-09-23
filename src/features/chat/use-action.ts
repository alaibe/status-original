import { useState } from 'react';

import { toast } from '@/design';
import { errorMessage } from '@/core/errors';

export function useAction<A extends unknown[]>(
  action: (...args: A) => Promise<unknown>,
  messages: { success?: string; failure: string }
) {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async run(...args: A): Promise<boolean> {
      if (busy) return false;
      setBusy(true);
      try {
        await action(...args);
        if (messages.success) toast.success(messages.success);
        return true;
      } catch (error) {
        toast.error(errorMessage(error, messages.failure));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
