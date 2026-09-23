import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, Card, ListItem, Text } from '@/design';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatSession } from '@/core/messaging/protocol';
import { guideUrl } from '@/lib/guide';
import { openExternal } from '@/lib/open-url';
import { connectByChat, existingBotChat } from '@/features/bridge-login/connect-by-chat';
import {
  bridgeBotId,
  KNOWN_BRIDGES,
  provisioningName,
  type KnownBridge,
} from '@/protocols/matrix/bridges';
import type { MatrixCapabilities } from '@/protocols/matrix/provisioning';

const PROTOCOL = 'matrix';

interface FoundBridge {
  bridge: KnownBridge;
  botId: string;
  /** Signed-in accounts, or `null` when the bridge's login API is out of reach. */
  accounts: string[] | null;
}

export function MatrixBridges({ session }: { session: ChatSession & Partial<MatrixCapabilities> }) {
  const resolvePeer = useChatStore((s) => s.resolvePeer);
  useChatStore((s) => s.conversations);
  const [found, setFound] = useState<FoundBridge[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const self = session.self.address;

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      KNOWN_BRIDGES.map(async (bridge): Promise<FoundBridge | null> => {
        const botId = await resolvePeer(PROTOCOL, bridgeBotId(bridge, self)).catch(() => null);
        if (!botId) return null;
        const whoami = await session
          .bridgeProvisioning?.(provisioningName(bridge))
          ?.whoami()
          .catch(() => null);
        const accounts = whoami ? whoami.logins.map((login) => login.name || login.id) : null;
        return { bridge, botId, accounts };
      })
    ).then((results) => {
      if (!cancelled) setFound(results.filter((result) => result !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [resolvePeer, self, session]);

  async function connect(item: FoundBridge) {
    if (item.accounts !== null) {
      router.push({ pathname: '/bridge-login', params: { bridge: item.bridge.localpart } });
      return;
    }
    setBusy(item.botId);
    await connectByChat(item.bridge, item.botId);
    setBusy(null);
  }

  return (
    <Card className="gap-2" testID="matrix-bridges">
      <Text variant="footnote" className="font-semibold">
        Bridges on this server
      </Text>
      {found === null ? (
        <Text variant="caption">Looking for bridges…</Text>
      ) : found.length === 0 ? (
        <>
          <Text variant="caption">
            This homeserver runs none of the usual bridges. A bridge brings WhatsApp, Signal,
            Messenger and others into this list.
          </Text>
          <Button
            label="How to add bridges"
            tone="neutral"
            size="sm"
            onPress={() => openExternal(guideUrl('homeserver')).catch(() => {})}
          />
        </>
      ) : (
        <>
          <Text variant="caption">
            Connect signs you in to the network through its bridge. Your chats from there then
            appear in this list.
          </Text>
          {found.map((item) => {
            const connected = item.accounts !== null && item.accounts.length > 0;
            const chat = item.accounts === null && existingBotChat(item.botId);
            return (
              <ListItem
                key={item.botId}
                testID={`matrix-bridge-${item.bridge.localpart}`}
                title={item.bridge.network}
                subtitle={connected ? `Signed in as ${item.accounts!.join(', ')}` : item.botId}
                trailing={
                  <Button
                    label={connected ? 'Manage' : chat ? 'Open' : 'Connect'}
                    size="sm"
                    tone={connected || chat ? 'neutral' : undefined}
                    loading={busy === item.botId}
                    disabled={busy !== null}
                    onPress={() => connect(item)}
                  />
                }
              />
            );
          })}
        </>
      )}
    </Card>
  );
}
