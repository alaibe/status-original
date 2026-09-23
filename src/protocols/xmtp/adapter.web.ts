import {
  Client,
  ConsentState,
  DeliveryStatus,
  Dm,
  Group,
  IdentifierKind,
  ListConversationsOrderBy,
  Opfs,
  PermissionLevel,
  ReactionAction,
  ReactionSchema,
  SortDirection,
  encodeText,
  isAttachment,
  isGroupUpdated,
  isReaction,
  isReadReceipt,
  isReply,
  isText,
  isTextReply,
  type DecodedMessage,
  type GroupUpdated,
  type Identifier,
  type Signer,
  type XmtpEnv,
} from '@xmtp/browser-sdk';
import type { ContentCodec } from '@xmtp/content-type-primitives';
import { hexToBytes, isAddress, type LocalAccount } from 'viem';

import {
  classifyAttachment,
  readInlineAttachment,
  writeInlineAttachment,
} from '@/core/messaging/attachments';
import type { ChatSession, GroupInfo } from '@/core/messaging/protocol';
import type {
  ChatMessage,
  Conversation,
  ConversationId,
  GroupMember,
  GroupRole,
  MessageContent,
  MessageId,
  ParticipantId,
  SelfIdentity,
  Unsubscribe,
} from '@/core/messaging/types';
import { isParticipantId } from '@/core/messaging/bots';
import { base64ToBytes, bytesToBase64 } from '@/lib/bytes';
import { PLUGIN_AUTHORITY } from './codec';
import {
  fallbackFilename,
  fallbackMimeType,
  xmtpEnvironment,
  type XmtpEnvironment,
} from './shared';

const VISIBLE = [ConsentState.Allowed, ConsentState.Unknown];

function identifierFor(address: string): Identifier {
  return { identifier: address.toLowerCase(), identifierKind: IdentifierKind.Ethereum };
}

function signerForAccount(account: LocalAccount): Signer {
  return {
    type: 'EOA',
    getIdentifier: () => identifierFor(account.address),
    signMessage: async (message: string) => hexToBytes(await account.signMessage({ message })),
  };
}

// One OPFS database per account and network, named so it can be erased later.
function databasePath(env: XmtpEnv, address: string): string {
  return `xmtp-${env}-${address.toLowerCase()}.db3`;
}

export interface XmtpConnectOptions {
  accountId: string;
  account: LocalAccount;
  dbEncryptionKey: Uint8Array;
  env?: XmtpEnvironment;
  codecs?: ContentCodec<any>[];
  appVersion?: string;
}

export interface XmtpEraseOptions {
  address: string;
  dbEncryptionKey: Uint8Array;
  env?: XmtpEnvironment;
}

export async function eraseXmtpLocalDatabase(options: XmtpEraseOptions): Promise<void> {
  const opfs = await Opfs.create();
  try {
    await opfs.deleteFile(databasePath(options.env ?? xmtpEnvironment(), options.address));
  } finally {
    opfs.close();
  }
}

export class XmtpSession implements ChatSession {
  readonly self: SelfIdentity;

  private readonly addressCache = new Map<ParticipantId, string>();
  private readonly streams = new Set<{ end(): Promise<unknown> }>();
  private closed = false;

  private constructor(
    private readonly client: Client<any>,
    private readonly codecsByTypeId: Map<string, ContentCodec<any>>,
    private readonly account: LocalAccount,
    private readonly accountId: string
  ) {
    this.self = {
      participantId: requireValue(client.inboxId, 'inbox id'),
      address: requireValue(client.accountIdentifier, 'account identifier').identifier,
    };
  }

  static async connect(opts: XmtpConnectOptions): Promise<XmtpSession> {
    const codecs = opts.codecs ?? [];
    const env = opts.env ?? xmtpEnvironment();
    const options = {
      env,
      dbPath: databasePath(env, opts.account.address),
      dbEncryptionKey: opts.dbEncryptionKey,
      appVersion: opts.appVersion,
      codecs,
    };

    // `build` needs no signature, so a registered account never touches its
    // key. Anything else registers through `create`.
    let client = await Client.build(identifierFor(opts.account.address), options).catch(
      () => undefined
    );
    if (!client || !(await client.isRegistered())) {
      client?.close();
      client = await Client.create(signerForAccount(opts.account), options);
    }

    const byTypeId = new Map<string, ContentCodec<any>>();
    for (const codec of codecs) byTypeId.set(codec.contentType.typeId, codec);

    return new XmtpSession(client, byTypeId, opts.account, opts.accountId);
  }

  async listConversations(): Promise<Conversation[]> {
    const raw = await this.client.conversations.list({
      consentStates: VISIBLE,
      orderBy: ListConversationsOrderBy.LastActivity,
    });
    return Promise.all(raw.map((c) => this.toConversation(c)));
  }

  async getMessages(id: ConversationId, opts?: { limit?: number }): Promise<ChatMessage[]> {
    const conversation = await this.client.conversations.getConversationById(id);
    if (!conversation) return [];

    const messages = await conversation.messages({
      limit: BigInt(opts?.limit ?? 100),
      direction: SortDirection.Descending,
    });
    const converted = await Promise.all(messages.map((m) => this.toMessage(m, id)));
    return converted.reverse();
  }

  async countUnread(id: ConversationId, since: number): Promise<number> {
    const conversation = await this.client.conversations.getConversationById(id);
    if (!conversation) return 0;
    const messages = await conversation.messages({
      limit: 1000n,
      ...(since > 0 ? { sentAfterNs: BigInt(since) * 1_000_000n } : {}),
      excludeSenderInboxIds: [this.self.participantId],
    });
    return messages.filter(
      (message) => !isReaction(message) && !isReadReceipt(message) && !isGroupUpdated(message)
    ).length;
  }

  async resolvePeer(addressOrId: string): Promise<ParticipantId | null> {
    const trimmed = addressOrId.trim();

    if (isParticipantId(trimmed)) return trimmed;
    if (!isAddress(trimmed)) return null;

    const identifier = identifierFor(trimmed);
    const reachable = await this.client.canMessage([identifier]);
    if (!(reachable.get(identifier.identifier) ?? reachable.get(trimmed))) return null;

    return (await this.client.fetchInboxIdByIdentifier(identifier)) ?? null;
  }

  async resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    const out: Record<ParticipantId, string> = {};
    const missing: ParticipantId[] = [];

    for (const id of ids) {
      const cached = this.addressCache.get(id);
      if (cached) out[id] = cached;
      else missing.push(id);
    }

    if (missing.length > 0) {
      try {
        const states = await this.client.preferences.fetchInboxStates(missing);
        for (const state of states) {
          const address = state.accountIdentifiers.find(
            (i) => i.identifierKind === IdentifierKind.Ethereum
          )?.identifier;
          if (!address) continue;
          this.addressCache.set(state.inboxId, address);
          out[state.inboxId] = address;
        }
      } catch (error) {
        console.warn('[xmtp] could not resolve addresses', error);
      }
    }

    return out;
  }

  async createDm(peer: ParticipantId): Promise<Conversation> {
    const dm = await this.client.conversations.createDm(peer);
    return this.toConversation(dm);
  }

  async createGroup(peers: ParticipantId[], title: string): Promise<Conversation> {
    const group = await this.client.conversations.createGroup(peers, { groupName: title });
    return this.toConversation(group);
  }

  private async requireGroup(id: ConversationId): Promise<Group<any>> {
    const conversation = await this.client.conversations.getConversationById(id);
    if (!conversation) throw new Error(`Conversation ${id} not found`);
    if (!(conversation instanceof Group)) {
      throw new Error('That only works in a group conversation.');
    }
    return conversation;
  }

  async getMembers(id: ConversationId): Promise<GroupMember[]> {
    const members = await (await this.requireGroup(id)).members();
    return members.map((m) => ({ id: m.inboxId, role: mapRole(m.permissionLevel) }));
  }

  async getGroupInfo(id: ConversationId): Promise<GroupInfo> {
    const group = await this.requireGroup(id);
    const members = await group.members();
    return {
      description: group.description,
      avatarUri: group.imageUrl || undefined,
      memberCount: members.length,
    };
  }

  async addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    await (await this.requireGroup(id)).addMembers(peers);
  }

  async removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    await (await this.requireGroup(id)).removeMembers(peers);
  }

  async renameGroup(id: ConversationId, title: string): Promise<void> {
    await (await this.requireGroup(id)).updateName(title);
  }

  async leaveGroup(id: ConversationId): Promise<void> {
    await (await this.requireGroup(id)).requestRemoval();
  }

  async send(id: ConversationId, content: MessageContent, replyTo?: MessageId): Promise<MessageId> {
    const conversation = await this.client.conversations.getConversationById(id);
    if (!conversation) throw new Error(`Conversation ${id} not found`);

    if (replyTo && content.kind === 'text') {
      return conversation.sendReply({
        reference: replyTo,
        content: await encodeText(content.text),
      });
    }

    if (content.kind === 'text') {
      return conversation.sendText(content.text);
    }

    if (content.kind === 'custom') {
      const codec = this.codecsByTypeId.get(content.typeId);
      if (!codec) {
        throw new Error(
          `No codec registered for "${content.typeId}". Is the owning plugin enabled?`
        );
      }
      const encoded = codec.encode(content.data);
      return conversation.send(
        { ...encoded, fallback: codec.fallback(content.data) },
        { shouldPush: codec.shouldPush(content.data) }
      );
    }

    if (content.kind === 'image' || content.kind === 'file' || content.kind === 'voice') {
      const filename =
        content.kind === 'file'
          ? content.name
          : (content.name ?? fallbackFilename(content.uri, content.kind));
      const mimeType = content.mimeType ?? fallbackMimeType(filename);

      const attachment = await readInlineAttachment(content.uri, filename, mimeType);
      return conversation.sendAttachment({
        filename,
        mimeType,
        content: base64ToBytes(attachment.data),
      });
    }

    if (content.kind === 'reaction') {
      const target = await this.client.conversations.getMessageById(content.targetId);
      return conversation.sendReaction({
        reference: content.targetId,
        referenceInboxId: target?.senderInboxId ?? '',
        action: content.action === 'removed' ? ReactionAction.Removed : ReactionAction.Added,
        schema: ReactionSchema.Unicode,
        content: content.emoji,
      });
    }

    throw new Error(`Cannot send content of kind "${content.kind}"`);
  }

  async setConsent(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void> {
    const conversation = await this.client.conversations.getConversationById(id);
    if (!conversation) return;
    await conversation.updateConsentState(
      consent === 'allowed' ? ConsentState.Allowed : ConsentState.Denied
    );
  }

  async sendReadReceipt(id: ConversationId): Promise<void> {
    const conversation = await this.client.conversations.getConversationById(id);
    if (!conversation) return;
    await conversation.sendReadReceipt();
  }

  async listInstallations(): Promise<{ id: string; createdAt?: number; current: boolean }[]> {
    const state = await this.client.preferences.fetchInboxState();
    const current = this.client.installationId;

    return state.installations.map((installation) => ({
      id: installation.id,
      createdAt:
        installation.clientTimestampNs === undefined
          ? undefined
          : Number(installation.clientTimestampNs / 1_000_000n),
      current: installation.id === current,
    }));
  }

  async revokeInstallations(ids: string[]): Promise<void> {
    await Client.revokeInstallations(
      signerForAccount(this.account),
      this.self.participantId,
      ids.map((id) => hexToBytes(id.startsWith('0x') ? (id as `0x${string}`) : `0x${id}`)),
      xmtpEnvironment()
    );
  }

  async sync(): Promise<void> {
    await this.client.conversations.syncAll(VISIBLE);
  }

  async streamMessages(onMessage: (m: ChatMessage) => void): Promise<Unsubscribe> {
    const stream = await this.client.conversations.streamAllMessages({
      consentStates: VISIBLE,
      onError: (error) => console.warn('[xmtp] message stream error', error),
    });
    return this.consume(stream, async (message) => {
      onMessage(await this.toMessage(message, message.conversationId));
    });
  }

  async streamDeletedMessages(
    listener: (id: ConversationId, messageIds: MessageId[]) => void
  ): Promise<Unsubscribe> {
    const stream = await this.client.conversations.streamDeletedMessages({
      onError: (error) => console.warn('[xmtp] deletion stream error', error),
    });
    return this.consume(stream, (message) => listener(message.conversationId, [message.id]));
  }

  async streamConversations(onConversation: (c: Conversation) => void): Promise<Unsubscribe> {
    const stream = await this.client.conversations.stream({
      onError: (error) => console.warn('[xmtp] conversation stream error', error),
    });
    return this.consume(stream, async (conversation) => {
      const converted = await this.toConversation(conversation, () => !this.closed);
      if (!this.closed) onConversation(converted);
    });
  }

  /**
   * Streams queue every value until something reads it, so they are drained
   * here rather than observed through `onValue`.
   */
  private consume<T>(
    stream: AsyncIterable<T> & { end(): Promise<unknown> },
    handle: (value: T) => void | Promise<void>
  ): Unsubscribe {
    this.streams.add(stream);
    void (async () => {
      try {
        for await (const value of stream) {
          if (this.closed) break;
          await handle(value);
        }
      } catch (error) {
        console.warn('[xmtp] stream ended with an error', error);
      } finally {
        this.streams.delete(stream);
      }
    })();
    return () => {
      this.streams.delete(stream);
      void stream.end();
    };
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    for (const stream of this.streams) void stream.end();
    this.streams.clear();
    this.client.close();
  }

  async eraseLocalDatabase(): Promise<void> {
    this.client.close();
    await eraseXmtpLocalDatabase({
      address: this.account.address,
      dbEncryptionKey: new Uint8Array(),
      env: this.client.env as XmtpEnvironment | undefined,
    });
  }

  private async toConversation(
    raw: Group<any> | Dm<any>,
    current: () => boolean = () => true
  ): Promise<Conversation> {
    const isGroup = raw instanceof Group;

    let title: string;
    let memberIds: ParticipantId[] = [];
    let selfRole: GroupRole | undefined;

    if (isGroup) {
      const members = await raw.members();
      title = raw.name?.trim() || 'Untitled group';
      memberIds = members.map((m) => m.inboxId);
      selfRole = mapRole(
        members.find((m) => m.inboxId === this.self.participantId)?.permissionLevel
      );
    } else {
      const peer = await (raw as Dm<any>).peerInboxId();
      title = peer;
      memberIds = [peer, this.self.participantId];
    }

    const [consent, last] = await Promise.all([
      raw.consentState(),
      current() ? raw.lastMessage() : undefined,
    ]);
    const lastMessage = current() && last ? await this.toMessage(last, raw.id) : undefined;

    return {
      id: raw.id,
      kind: isGroup ? 'group' : 'dm',
      title,
      memberIds,
      createdAt: raw.createdAt?.getTime() ?? Date.now(),
      consent: mapConsent(consent),
      selfRole,
      lastMessage,
    };
  }

  private async toMessage(
    raw: DecodedMessage<any>,
    conversationId: ConversationId
  ): Promise<ChatMessage> {
    return {
      id: raw.id,
      conversationId,
      senderId: raw.senderInboxId,
      sentAt: Number(raw.sentAtNs / 1_000_000n),
      fromMe: raw.senderInboxId === this.self.participantId,
      status: raw.deliveryStatus === DeliveryStatus.Failed ? 'failed' : 'sent',
      content: await this.toContent(raw),
      replyTo: isReply(raw) ? raw.content?.referenceId : undefined,
    };
  }

  // Attachments are written to disk by the Rust side, hence the promise.
  private async toContent(raw: DecodedMessage<any>): Promise<MessageContent> {
    const typeId = raw.contentType.typeId;
    const unsupported = (fallback?: string): MessageContent => ({
      kind: 'unsupported',
      typeId,
      fallback: raw.fallback ?? fallback ?? 'Unsupported message',
    });

    if (isText(raw)) {
      return raw.content === undefined ? unsupported() : { kind: 'text', text: raw.content };
    }

    if (isGroupUpdated(raw)) {
      return raw.content === undefined
        ? unsupported('Group updated')
        : { kind: 'system', text: describeGroupUpdate(raw.content) };
    }

    if (isAttachment(raw)) {
      const attachment = raw.content;
      if (attachment === undefined) return unsupported('Attachment');
      const filename = attachment.filename ?? 'attachment';
      const { mimeType } = attachment;
      const uri = await writeInlineAttachment(
        raw.id,
        { filename, mimeType, data: bytesToBase64(attachment.content) },
        this.accountId
      );
      const kind = classifyAttachment(mimeType, filename);

      if (kind === 'image') return { kind: 'image', uri, name: filename, mimeType };
      if (kind === 'voice') {
        return { kind: 'voice', uri, durationMs: 0, name: filename, mimeType };
      }
      return { kind: 'file', uri, name: filename, mimeType };
    }

    if (isTextReply(raw) && raw.content !== undefined) {
      return { kind: 'text', text: raw.content.content };
    }

    if (isReply(raw)) {
      return { kind: 'unsupported', typeId: 'reply', fallback: raw.fallback ?? 'Reply' };
    }

    if (isReaction(raw)) {
      const reaction = raw.content;
      if (reaction === undefined) return unsupported('Reaction');
      return {
        kind: 'reaction',
        targetId: reaction.reference,
        emoji: reaction.content,
        action: reaction.action === ReactionAction.Removed ? 'removed' : 'added',
      };
    }

    if (raw.contentType.authorityId === PLUGIN_AUTHORITY && raw.content !== undefined) {
      return { kind: 'custom', typeId, data: raw.content, fallback: raw.fallback };
    }

    return unsupported();
  }
}

function requireValue<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`XMTP client has no ${what}.`);
  return value;
}

function mapRole(level: PermissionLevel | undefined): GroupRole {
  if (level === PermissionLevel.SuperAdmin) return 'owner';
  if (level === PermissionLevel.Admin) return 'admin';
  return 'member';
}

function mapConsent(state: ConsentState): Conversation['consent'] {
  if (state === ConsentState.Allowed) return 'allowed';
  if (state === ConsentState.Denied) return 'denied';
  return 'unknown';
}

function describeGroupUpdate(update: GroupUpdated): string {
  const parts: string[] = [];
  if (update.addedInboxes.length) parts.push(`${update.addedInboxes.length} joined`);
  const left = update.removedInboxes.length + update.leftInboxes.length;
  if (left) parts.push(`${left} left`);
  for (const field of update.metadataFieldChanges) {
    if (field.fieldName === 'group_name') parts.push(`Renamed to "${field.newValue}"`);
  }
  return parts.join(' · ') || 'Group updated';
}
