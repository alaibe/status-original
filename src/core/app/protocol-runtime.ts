import type { LocalAccount } from 'viem';

import { errorMessage } from '../errors';
import type { DerivedKey, Keyring } from '../identity/keyring';
import { useChatStore, type ProtocolConnection } from '../messaging/chat-store';
import { loadProtocolConfig } from '../messaging/config';
import {
  namespacedId,
  namespaceConversation,
  namespaceMessage,
  type ProtocolId,
} from '../messaging/namespace';
import type { ChatSession, CustomContentType } from '../messaging/protocol';
import {
  effectiveConfig,
  isConfigured,
  transportProtocols,
  type ProtocolDescriptor,
} from '../messaging/registry';
import type { Unsubscribe } from '../messaging/types';
import type { AccountStorage } from '@/storage/account';

export type SessionFactory = (params: {
  protocolId: ProtocolId;
  account: LocalAccount;
  derive(path: string): DerivedKey;
  contentTypes: CustomContentType[];
}) => Promise<ChatSession>;

export interface ProtocolAccount {
  accountId: string;
  keyring: Pick<Keyring, 'account' | 'derive'>;
  contentTypes(): CustomContentType[];
  createSession?: SessionFactory;
  only?: ProtocolId[];
}

export class ProtocolRuntime {
  private subscriptions = new Map<ProtocolId, Unsubscribe[]>();
  private sessions = new Map<ProtocolId, ChatSession>();

  constructor(private readonly descriptors: readonly ProtocolDescriptor[]) {}

  async connect(
    input: ProtocolAccount,
    storage: AccountStorage,
    active: () => boolean,
    only?: ProtocolId[]
  ): Promise<void> {
    if (!active()) return;
    useChatStore.setState({ status: 'connecting', error: null });
    const selected = input.only ?? (input.createSession ? ['xmtp' as const] : undefined);
    const descriptors = transportProtocols(this.descriptors).filter(
      (descriptor) =>
        (!selected || selected.includes(descriptor.id)) && (!only || only.includes(descriptor.id))
    );

    await Promise.all(
      descriptors.map(async (descriptor) => {
        if (!active()) return;
        const protocolId = descriptor.id;
        const subscriptions: Unsubscribe[] = [];
        this.subscriptions.set(protocolId, subscriptions);
        this.setProtocol(protocolId, { status: 'connecting', error: null });
        try {
          let session: ChatSession;
          if (input.createSession) {
            session = await input.createSession({
              protocolId,
              account: input.keyring.account,
              derive: input.keyring.derive,
              contentTypes: input.contentTypes(),
            });
          } else {
            const stored = await loadProtocolConfig(input.accountId, protocolId);
            if (!active()) return;
            const config = effectiveConfig(descriptor, stored);
            if (!isConfigured(descriptor, config)) {
              this.setProtocol(protocolId, { status: 'idle', error: null });
              return;
            }
            session = await descriptor.connect!({
              accountId: input.accountId,
              account: input.keyring.account,
              derive: input.keyring.derive,
              contentTypes: input.contentTypes(),
              config,
              storage: storage,
            });
          }

          if (!active()) {
            await session.disconnect().catch(() => {});
            return;
          }
          this.sessions.set(protocolId, session);
          useChatStore.setState((state) => ({
            sessions: { ...state.sessions, [protocolId]: session },
          }));
          this.setProtocol(protocolId, { status: 'ready', error: null });
          const live = () => active() && this.sessions.get(protocolId) === session;

          if (session.subscribeHistory) {
            subscriptions.push(
              session.subscribeHistory((history) => {
                if (!live()) return;
                this.setProtocol(protocolId, {
                  ...useChatStore.getState().protocols[protocolId],
                  history,
                });
              })
            );
          }
          if (session.subscribeLogin) {
            subscriptions.push(
              session.subscribeLogin((login) => {
                if (!live()) return;
                this.setProtocol(protocolId, {
                  ...useChatStore.getState().protocols[protocolId],
                  login,
                });
              })
            );
          }
          const stopMessages = await session.streamMessages((message) => {
            if (live())
              useChatStore.getState().ingestMessage(namespaceMessage(protocolId, message));
          });
          if (!live()) {
            stopMessages();
            await session.disconnect().catch(() => {});
            return;
          }
          subscriptions.push(stopMessages);

          if (session.streamDeletedMessages) {
            const stopDeleted = await session.streamDeletedMessages((id, messageIds) => {
              if (live())
                useChatStore.getState().removeMessages(namespacedId(protocolId, id), messageIds);
            });
            if (!live()) {
              stopDeleted();
              await session.disconnect().catch(() => {});
              return;
            }
            subscriptions.push(stopDeleted);
          }

          const stopConversations = await session.streamConversations((conversation) => {
            if (live()) {
              useChatStore
                .getState()
                .ingestConversation(namespaceConversation(protocolId, conversation));
            }
          });
          if (!live()) {
            stopConversations();
            await session.disconnect().catch(() => {});
            return;
          }
          subscriptions.push(stopConversations);
          const conversations = await session.listConversations();
          if (!live()) return;
          useChatStore
            .getState()
            .ingestConversations(
              conversations.map((conversation) => namespaceConversation(protocolId, conversation))
            );
          await useChatStore.getState().syncProtocol(protocolId);
        } catch (error) {
          if (active()) {
            this.setProtocol(protocolId, { status: 'error', error: errorMessage(error) });
          }
        }
      })
    );

    if (active()) this.rollUpStatus();
  }

  /** Drops the network projection of `only` (every network by default) but keeps local chats. */
  async stop(only?: ProtocolId[]): Promise<void> {
    await this.disconnect(only);
    const state = useChatStore.getState();
    const dropped = (protocol: string) => (only ? only.includes(protocol) : protocol !== 'local');
    const keep = <T>(record: Record<string, T>, protocolOf = (key: string) => key) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => !dropped(protocolOf(key))));
    const conversationProtocol = (id: string) => id.slice(0, id.indexOf('-'));
    useChatStore.setState({
      status: only ? state.status : 'idle',
      error: only ? state.error : null,
      sessions: keep(state.sessions),
      protocols: keep(state.protocols),
      syncing: only ? state.syncing : false,
      conversations: state.conversations.filter(
        (conversation) => !dropped(conversation.protocol ?? '')
      ),
      messages: keep(state.messages, conversationProtocol),
      rawMessages: keep(state.rawMessages, conversationProtocol),
    });
  }

  async disconnect(only?: ProtocolId[]): Promise<void> {
    const ids = only ?? [...new Set([...this.subscriptions.keys(), ...this.sessions.keys()])];
    const sessions: ChatSession[] = [];
    for (const id of ids) {
      for (const unsubscribe of this.subscriptions.get(id) ?? []) {
        try {
          unsubscribe();
        } catch {}
      }
      this.subscriptions.delete(id);
      const session = this.sessions.get(id);
      if (session) sessions.push(session);
      this.sessions.delete(id);
    }
    await Promise.all(sessions.map((session) => session.disconnect().catch(() => {})));
  }

  private setProtocol(id: ProtocolId, connection: ProtocolConnection): void {
    useChatStore.setState((state) => ({ protocols: { ...state.protocols, [id]: connection } }));
  }

  private rollUpStatus(): void {
    const state = useChatStore.getState();
    const connections = Object.values(state.protocols);
    const failures = connections.filter((connection) => connection.status === 'error');
    if (this.sessions.size > 0) {
      useChatStore.setState({ status: 'ready', error: failures[0]?.error ?? null });
    } else if (failures.length > 0) {
      useChatStore.setState({ status: 'error', error: failures[0].error });
    } else {
      useChatStore.setState({ status: 'idle', error: null });
    }
  }
}
