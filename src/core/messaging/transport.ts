import type { MessageContent, MessageId, ParticipantId, SelfIdentity } from './types';
import type { StoredConversation } from './message-store';

export interface TransportSink {
  deliverToRoutingKey(routingKey: string, message: IncomingMessage): Promise<void>;

  deliverToParticipants(
    participants: ParticipantId[],
    message: IncomingMessage,
    meta?: { title?: string; createdAt?: number },
  ): Promise<void>;
}

export interface IncomingMessage {
  id: MessageId;
  senderId: ParticipantId;
  sentAt: number;
  content: MessageContent;
  fromMe: boolean;
  transportTimestamp?: number;
}

export interface SendResult {
  id: MessageId;
  /**
   * Required only when a transport cannot read its own published message back.
   * Supplying it as well as a self-addressed wire copy would duplicate the send.
   */
  localMessage?: IncomingMessage;
}

export interface ChatTransport {
  readonly protocolId: string;
  readonly self: SelfIdentity;
  cursorUpperBound?(): number;

  conversationIdFor(participants: ParticipantId[]): string;

  routingKeyFor?(participants: ParticipantId[]): string;

  /**
   * `since` is the newest persisted message time, not the last delivery time.
   * It is undefined when the conversation has no local history.
   */
  openConversation?(conversation: StoredConversation, opts?: { since?: number }): Promise<void>;

  closeConversation?(conversation: StoredConversation): Promise<void>;

  send(conversation: StoredConversation, content: MessageContent): Promise<SendResult>;
  confirmSend?(conversationId: string, messageId: MessageId): void;

  resolvePeer(addressOrId: string): Promise<ParticipantId | null>;
  resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>>;

  sync(): Promise<void>;
  disconnect(): Promise<void>;

  readonly rosterIsFixed: { onAdd: string; onRemove: string };
}
