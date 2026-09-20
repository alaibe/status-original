import { useState } from 'react';
import { View } from 'react-native';

import { Button, Text } from '@/design';
import type { ConversationId } from '@/core/messaging/types';
import { decideConsent, type ConsentDecision } from './consent';

export function ConsentBar({ conversationId }: { conversationId: ConversationId }) {
  const [busy, setBusy] = useState<ConsentDecision | null>(null);

  async function decide(consent: ConsentDecision) {
    setBusy(consent);
    await decideConsent(conversationId, consent);
    setBusy(null);
  }

  return (
    <View className="gap-3 border-t border-line bg-surface-raised px-gutter pb-3 pt-3">
      <Text variant="caption" className="text-center">
        You have not replied to this conversation. Ignoring it removes it from your lists and stops
        the notifications, though it cannot stop them sending.
      </Text>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            testID="consent-ignore"
            label="Ignore"
            tone="neutral"
            fullWidth
            loading={busy === 'denied'}
            disabled={busy !== null}
            onPress={() => decide('denied')}
          />
        </View>
        <View className="flex-1">
          <Button
            testID="consent-accept"
            label="Accept"
            fullWidth
            loading={busy === 'allowed'}
            disabled={busy !== null}
            onPress={() => decide('allowed')}
          />
        </View>
      </View>
    </View>
  );
}
