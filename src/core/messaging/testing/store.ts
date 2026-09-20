import type { LocalAccount } from 'viem';

import { clearChatProjection, projectAccount } from '../chat-store';
import { namespacedId, splitConversationId, type ProtocolId } from '../namespace';
import { InMemoryMessageStore } from '../message-store';
import type { StoredConversation } from '../message-store';
import type { ChatSession } from '../protocol';
import { StoreBackedSession } from '../store-backed-session';
import type { ChatTransport, SendResult, TransportSink } from '../transport';
import type { MessageContent, ParticipantId } from '../types';
import { accountRuntime } from '@/runtime';
import { PluginRegistry } from '@/core/plugins/registry';
import type { Keyring } from '@/core/identity/keyring';
import { createAccountStorage, type AccountStorage } from '@/storage/account';

export const TEST_PROTOCOL: ProtocolId = 'xmtp';
export const STORE_TEST_SELF = 'me';
export const STORE_TEST_PEER = 'them';

export class StoreBackedTestTransport implements ChatTransport {
  readonly protocolId = 'stub';
  readonly self = { participantId: STORE_TEST_SELF, address: 'me@stub' };
  readonly rosterIsFixed = { onAdd: 'no', onRemove: 'no' };

  sink: TransportSink | null = null;
  opened: string[] = [];
  openCursors: (number | undefined)[] = [];
  sent = 0;
  disconnected = false;

  attach(sink: TransportSink): void {
    this.sink = sink;
  }

  conversationIdFor(participants: ParticipantId[]): string {
    return `c:${[...participants].sort().join('+')}`;
  }

  routingKeyFor(participants: ParticipantId[]): string {
    return `topic:${[...participants].sort().join('+')}`;
  }

  async openConversation(
    conversation: StoredConversation,
    options?: { since?: number },
  ): Promise<void> {
    this.opened.push(conversation.routingKey ?? conversation.id);
    this.openCursors.push(options?.since);
  }

  async send(
    _conversation: StoredConversation,
    content: MessageContent,
  ): Promise<SendResult> {
    this.sent += 1;
    const id = `m${this.sent}`;
    return {
      id,
      localMessage: {
        id,
        senderId: STORE_TEST_SELF,
        sentAt: this.sent * 1000,
        content,
        fromMe: true,
      },
    };
  }

  async resolvePeer(id: string): Promise<ParticipantId> {
    return id;
  }

  async resolveAddresses(): Promise<Record<ParticipantId, string>> {
    return {};
  }

  async sync(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }

  receive(id: string, sentAt: number, text = id): Promise<void> {
    return this.sink?.deliverToParticipants([STORE_TEST_SELF, STORE_TEST_PEER], {
      id,
      senderId: STORE_TEST_PEER,
      sentAt,
      transportTimestamp: sentAt,
      content: { kind: 'text', text },
      fromMe: false,
    }) ?? Promise.resolve();
  }
}

export async function storeBackedSession(store = new InMemoryMessageStore()) {
  const transport = new StoreBackedTestTransport();
  const session = new StoreBackedSession(transport, store);
  transport.attach(session);
  await session.hydrate();
  return { session, transport };
}

export const flushWrites = () => new Promise<void>((resolve) => setImmediate(resolve));

export function ns(nativeId: string, protocol: ProtocolId = TEST_PROTOCOL): string {
  return namespacedId(protocol, nativeId);
}

export function native(id: string): string {
  return splitConversationId(id)?.nativeId ?? id;
}

export interface ConnectFakeOptions {
  accountId?: string;
  protocols?: ProtocolId[];
  sessionFor?(protocolId: ProtocolId): ChatSession;
}

export async function connectFake(
  session: ChatSession,
  options: ConnectFakeOptions = {}
): Promise<void> {
  const accountId = options.accountId ?? 'test-account';
  const keyring = {
    kind: 'phrase',
    mnemonic: null,
    account: {} as LocalAccount,
    address: '0x0000000000000000000000000000000000000000',
    derive: () => ({ path: '', privateKey: new Uint8Array(), publicKey: new Uint8Array() }),
    deriveEd25519: () => ({ path: '', privateKey: new Uint8Array(), publicKey: new Uint8Array() }),
  } as Keyring;
  await accountRuntime.synchronize({
    accountId,
    keyring,
    registry: new PluginRegistry(),
    defaultEnabled: [],
    makeContext: () => { throw new Error('No plugins in this test.'); },
    only: options.protocols,
    createSession: async ({ protocolId }) =>
      options.sessionFor ? options.sessionFor(protocolId) : session,
    storage: testAccountStorage(accountId),
  });
}

export function projectTestAccount(
  accountId: string,
  messages = createAccountStorage(accountId).messages,
): void {
  projectAccount({ ...createAccountStorage(accountId), messages });
}

export function disconnectFake(): Promise<void> {
  return accountRuntime.disconnect();
}

function testAccountStorage(accountId: string): AccountStorage {
  return { ...createAccountStorage(accountId), messages: new InMemoryMessageStore() };
}

export function resetChatStore(): void {
  clearChatProjection();
}
