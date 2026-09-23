import { useEffect, useState } from 'react';

import { Button, Card, ListItem, Text, toast } from '@/design';
import { errorMessage } from '@/core/errors';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatSession } from '@/core/messaging/protocol';
import { guideUrl } from '@/lib/guide';
import { openExternal } from '@/lib/open-url';
import { openChat } from '@/features/navigation/open';
import { bridgeBotId, KNOWN_BRIDGES, type KnownBridge } from '@/protocols/matrix/bridges';

const PROTOCOL = 'matrix';
const JOIN_TIMEOUT_MS = 20_000;

interface FoundBridge {
  bridge: KnownBridge;
  botId: string;
}

async function hasJoined(conversationId: string, botId: string): Promise<boolean> {
  const deadline = Date.now() + JOIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const members = await useChatStore
      .getState()
      .getMembers(conversationId)
      .catch(() => []);
    if (members.some((member) => member.id === botId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export function MatrixBridges({ session }: { session: ChatSession }) {
  const resolvePeer = useChatStore((s) => s.resolvePeer);
  const startDm = useChatStore((s) => s.startDm);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const conversations = useChatStore((s) => s.conversations);
  const [found, setFound] = useState<FoundBridge[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const self = session.self.address;

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      KNOWN_BRIDGES.map(async (bridge) => {
        const botId = bridgeBotId(bridge, self);
        const peer = await resolvePeer(PROTOCOL, botId).catch(() => null);
        return peer ? { bridge, botId: peer } : null;
      })
    ).then((results) => {
      if (!cancelled) setFound(results.filter((result) => result !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [resolvePeer, self]);

  function existingChat(botId: string) {
    return conversations.find(
      (c) => c.protocol === PROTOCOL && c.kind === 'dm' && c.memberIds.includes(botId)
    );
  }

  async function connect({ bridge, botId }: FoundBridge) {
    const existing = existingChat(botId);
    if (existing) {
      openChat(existing.id);
      return;
    }
    setBusy(botId);
    try {
      const conversation = await startDm(PROTOCOL, botId);
      openChat(conversation.id);
      if (!(await hasJoined(conversation.id, botId))) {
        toast.error(
          `The ${bridge.network} bridge did not answer. Send it “${bridge.firstCommand}” once it joins.`
        );
      } else {
        await sendMessage(conversation.id, { kind: 'text', text: bridge.firstCommand });
      }
    } catch (e) {
      toast.error(errorMessage(e, `Could not reach the ${bridge.network} bridge`));
    }
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
            Connect opens a chat with the network’s bridge bot and asks it to sign you in. Answer
            its questions there; your chats from that network then appear here.
          </Text>
          {found.map((item) => (
            <ListItem
              key={item.botId}
              testID={`matrix-bridge-${item.bridge.localpart}`}
              title={item.bridge.network}
              subtitle={item.botId}
              trailing={
                <Button
                  label={existingChat(item.botId) ? 'Open' : 'Connect'}
                  size="sm"
                  tone={existingChat(item.botId) ? 'neutral' : undefined}
                  loading={busy === item.botId}
                  disabled={busy !== null}
                  onPress={() => connect(item)}
                />
              }
            />
          ))}
        </>
      )}
    </Card>
  );
}
