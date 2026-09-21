import {
  Client,
  ConsentState,
  ConversationVersion,
  Dm,
  Group,
  PublicIdentity,
  type Signer,
  type Conversation as XmtpConversation,
  type DecodedMessage,
  type ConversationId as XmtpConversationId,
  type InboxId,
  type JSContentCodec,
  type XMTPEnvironment,
} from '@xmtp/react-native-sdk';
import { isAddress, type LocalAccount } from 'viem';

import {
  classifyAttachment,
  readInlineAttachment,
  writeInlineAttachment,
} from '@/core/messaging/attachments';
import type { ChatSession } from '@/core/messaging/protocol';
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
import { PLUGIN_AUTHORITY } from './codec';
import { fallbackFilename, fallbackMimeType, xmtpEnvironment } from './shared';



function signerForAccount(account: LocalAccount): Signer {
  return {
    getIdentifier: async () => new PublicIdentity(account.address, 'ETHEREUM'),
    getChainId: () => undefined,
    getBlockNumber: () => undefined,
    signerType: () => 'EOA',
    signMessage: async (message: string) => ({
      signature: await account.signMessage({ message }),
    }),
  };
}

export interface XmtpConnectOptions {
  accountId: string;
  account: LocalAccount;
  dbEncryptionKey: Uint8Array;
  env?: XMTPEnvironment;
  codecs?: JSContentCodec<any>[];
  appVersion?: string;
}

export interface XmtpEraseOptions {
  address: string;
  dbEncryptionKey: Uint8Array;
  env?: XMTPEnvironment;
}

export async function eraseXmtpLocalDatabase(options: XmtpEraseOptions): Promise<void> {
  const client = await Client.build(
    new PublicIdentity(options.address, 'ETHEREUM'),
    {
      env: options.env ?? xmtpEnvironment(),
      dbEncryptionKey: options.dbEncryptionKey,
    },
  );
  await client.deleteLocalDatabase();
}

export class XmtpSession implements ChatSession {
  readonly self: SelfIdentity;

  private readonly addressCache = new Map<ParticipantId, string>();
  private closed = false;

  private constructor(
    private readonly client: Client<any>,
    private readonly codecsByTypeId: Map<string, JSContentCodec<any>>,
    private readonly account: LocalAccount,
    private readonly accountId: string
  ) {
    this.self = {
      participantId: client.inboxId,
      address: client.publicIdentity.identifier,
    };
  }

  static async connect(opts: XmtpConnectOptions): Promise<XmtpSession> {
    const codecs = opts.codecs ?? [];
    const options = {
      env: opts.env ?? xmtpEnvironment(),
      dbEncryptionKey: opts.dbEncryptionKey,
      appVersion: opts.appVersion,
      codecs,
    };

    const client = await Client.build(
      new PublicIdentity(opts.account.address, 'ETHEREUM'),
      options
    ).catch(async () => Client.create(signerForAccount(opts.account), options));

    const byTypeId = new Map<string, JSContentCodec<any>>();
    for (const codec of codecs) byTypeId.set(codec.contentType.typeId, codec);

    return new XmtpSession(client, byTypeId, opts.account, opts.accountId);
  }

  async listConversations(): Promise<Conversation[]> {
    const raw = await this.client.conversations.list(
      undefined,
      undefined,
      ['allowed', 'unknown'],
      undefined,
      undefined,
      undefined,
      undefined,
      'last_activity'
    );
    return Promise.all(raw.map((c) => this.toConversation(c)));
  }

  async getMessages(id: ConversationId, opts?: { limit?: number }): Promise<ChatMessage[]> {
    const conversation = await this.client.conversations.findConversation(toXmtpId(id));
    if (!conversation) return [];

    const messages = await conversation.messages({ limit: opts?.limit ?? 100 });
    return (await Promise.all(messages.map((m) => this.toMessage(m, id)))).reverse();
  }

  async resolvePeer(addressOrId: string): Promise<ParticipantId | null> {
    const trimmed = addressOrId.trim();

    if (isParticipantId(trimmed)) return trimmed as InboxId;
    if (!isAddress(trimmed)) return null;

    const identity = new PublicIdentity(trimmed, 'ETHEREUM');
    const reachable = await this.client.canMessage([identity]);
    if (!reachable[identity.identifier]) return null;

    const inboxId = await this.client.findInboxIdFromIdentity(identity);
    return inboxId ?? null;
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
        const states = await this.client.inboxStates(false, missing as InboxId[]);
        for (const state of states) {
          const address = state.identities.find((i) => i.kind === 'ETHEREUM')?.identifier;
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
    const dm = await this.client.conversations.findOrCreateDm(peer as InboxId);
    return this.toConversation(dm as unknown as XmtpConversation<any>);
  }

  async createGroup(peers: ParticipantId[], title: string): Promise<Conversation> {
    const group = await this.client.conversations.newGroup(peers as InboxId[], { name: title });
    return this.toConversation(group as unknown as XmtpConversation<any>);
  }

  private async requireGroup(id: ConversationId): Promise<Group<any>> {
    const conversation = await this.client.conversations.findConversation(toXmtpId(id));
    if (!conversation) throw new Error(`Conversation ${id} not found`);
    if (conversation.version !== ConversationVersion.GROUP) {
      throw new Error('That only works in a group conversation.');
    }
    return conversation as Group<any>;
  }

  async getMembers(id: ConversationId): Promise<GroupMember[]> {
    const members = await (await this.requireGroup(id)).members();
    return members.map((m) => ({ id: m.inboxId, role: mapRole(m.permissionLevel) }));
  }

  async addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    await (await this.requireGroup(id)).addMembers(peers as InboxId[]);
  }

  async removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    await (await this.requireGroup(id)).removeMembers(peers as InboxId[]);
  }

  async renameGroup(id: ConversationId, title: string): Promise<void> {
    await (await this.requireGroup(id)).updateName(title);
  }

  async leaveGroup(id: ConversationId): Promise<void> {
    await (await this.requireGroup(id)).leaveGroup();
  }

  async send(
    id: ConversationId,
    content: MessageContent,
    replyTo?: MessageId
  ): Promise<MessageId> {
    const conversation = await this.client.conversations.findConversation(toXmtpId(id));
    if (!conversation) throw new Error(`Conversation ${id} not found`);

    if (replyTo && content.kind === 'text') {
      return conversation.send({
        reply: { reference: replyTo as never, content: { text: content.text } },
      });
    }

    if (content.kind === 'text') {
      return conversation.send({ text: content.text });
    }

    if (content.kind === 'custom') {
      const codec = this.codecsByTypeId.get(content.typeId);
      if (!codec) {
        throw new Error(
          `No codec registered for "${content.typeId}". Is the owning plugin enabled?`
        );
      }
      type CodecPayload = Parameters<typeof codec.encode>[0];
      return conversation.send(content.data as CodecPayload, {
        contentType: codec.contentType,
      });
    }

    if (content.kind === 'image' || content.kind === 'file' || content.kind === 'voice') {
      const filename =
        content.kind === 'file'
          ? content.name
          : (content.name ?? fallbackFilename(content.uri, content.kind));
      const mimeType = content.mimeType ?? fallbackMimeType(filename);

      const attachment = await readInlineAttachment(content.uri, filename, mimeType);
      return conversation.send({ attachment });
    }

    if (content.kind === 'reaction') {
      return conversation.send({
        reaction: {
          reference: content.targetId,
          action: content.action,
          schema: 'unicode',
          content: content.emoji,
        },
      });
    }

    throw new Error(`Cannot send content of kind "${content.kind}"`);
  }

  async setConsent(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void> {
    const conversation = await this.client.conversations.findConversation(toXmtpId(id));
    if (!conversation) return;
    await conversation.updateConsent(consent);
  }

  async sendReadReceipt(id: ConversationId): Promise<void> {
    const conversation = await this.client.conversations.findConversation(toXmtpId(id));
    if (!conversation) return;
    await conversation.send({ readReceipt: {} });
  }

  async listInstallations(): Promise<{ id: string; createdAt?: number; current: boolean }[]> {
    const state = await this.client.inboxState(true);
    const current = this.client.installationId;

    return state.installations.map((installation) => ({
      id: installation.id,
      createdAt: installation.createdAt,
      current: installation.id === current,
    }));
  }

  async revokeInstallations(ids: string[]): Promise<void> {
    await Client.revokeInstallations(
      xmtpEnvironment(),
      signerForAccount(this.account),
      this.client.inboxId,
      ids as Parameters<typeof Client.revokeInstallations>[3]
    );
  }

  async sync(): Promise<void> {
    await this.client.conversations.syncAllConversations(['allowed', 'unknown']);
  }

  async streamMessages(onMessage: (m: ChatMessage) => void): Promise<Unsubscribe> {
    await this.client.conversations.streamAllMessages(
      async (message) => {
        if (this.closed) return;
        onMessage(await this.toMessage(message, message.topic));
      },
      'all',
      ['allowed', 'unknown']
    );
    return () => this.client.conversations.cancelStreamAllMessages();
  }

  async streamConversations(onConversation: (c: Conversation) => void): Promise<Unsubscribe> {
    await this.client.conversations.stream(async (conversation) => {
      const converted = await this.toConversation(conversation, () => !this.closed);
      if (!this.closed) onConversation(converted);
    });
    return () => this.client.conversations.cancelStream();
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    this.client.conversations.cancelStream();
    this.client.conversations.cancelStreamAllMessages();
  }

  async eraseLocalDatabase(): Promise<void> {
    await this.client.deleteLocalDatabase();
  }

  private async toConversation(
    raw: XmtpConversation<any>,
    current: () => boolean = () => true
  ): Promise<Conversation> {
    const isGroup = raw.version === ConversationVersion.GROUP;

    let title: string;
    let memberIds: ParticipantId[] = [];

    let selfRole: GroupRole | undefined;

    if (isGroup) {
      const group = raw as Group<any>;
      const [name, members] = await Promise.all([group.name(), group.members()]);
      title = name?.trim() || 'Untitled group';
      memberIds = members.map((m) => m.inboxId);
      selfRole = mapRole(
        members.find((m) => m.inboxId === this.self.participantId)?.permissionLevel
      );
    } else {
      const peer = await (raw as Dm<any>).peerInboxId();
      title = peer;
      memberIds = [peer, this.self.participantId];
    }

    return {
      id: raw.id,
      kind: isGroup ? 'group' : 'dm',
      title,
      memberIds,
      createdAt: raw.createdAt,
      consent: mapConsent(raw.state),
      selfRole,
      lastMessage:
        current() && raw.lastMessage ? await this.toMessage(raw.lastMessage, raw.id) : undefined,
    };
  }

  private async toMessage(raw: DecodedMessage<any>, conversationId: ConversationId): Promise<ChatMessage> {
    return {
      id: raw.id,
      conversationId,
      senderId: raw.senderInboxId,
      sentAt: Math.round(raw.sentNs / 1_000_000),
      fromMe: raw.senderInboxId === this.self.participantId,
      status: raw.deliveryStatus === 'FAILED' ? 'failed' : 'sent',
      content: await this.toContent(raw),
      replyTo: raw.nativeContent?.reply?.reference,
    };
  }

  private async toContent(raw: DecodedMessage<any>): Promise<MessageContent> {
    const native = raw.nativeContent;

    if (typeof native?.text === 'string') {
      return { kind: 'text', text: native.text };
    }

    if (native?.groupUpdated) {
      return { kind: 'system', text: describeGroupUpdate(native.groupUpdated) };
    }

    if (native?.attachment) {
      const { filename, mimeType, data } = native.attachment;
      const uri = await writeInlineAttachment(raw.id, { filename, mimeType, data }, this.accountId);
      const kind = classifyAttachment(mimeType, filename);

      if (kind === 'image') return { kind: 'image', uri, name: filename, mimeType };
      if (kind === 'voice') {
        return { kind: 'voice', uri, durationMs: 0, name: filename, mimeType };
      }
      return { kind: 'file', uri, name: filename, mimeType };
    }

    if (native?.reply) {
      const inner = native.reply.content;
      if (typeof inner?.text === 'string') {
        return { kind: 'text', text: inner.text };
      }
      return { kind: 'unsupported', typeId: 'reply', fallback: raw.fallback ?? 'Reply' };
    }

    const reaction = native?.reaction ?? native?.reactionV2;
    if (reaction) {
      return {
        kind: 'reaction',
        targetId: reaction.reference,
        emoji: reaction.content,
        action: reaction.action === 'removed' ? 'removed' : 'added',
      };
    }

    const contentTypeId = raw.contentTypeId ?? '';
    if (contentTypeId.startsWith(PLUGIN_AUTHORITY)) {
      const typeId = parseTypeId(contentTypeId);

      if (native?.unknown) {
        return {
          kind: 'unsupported',
          typeId,
          fallback: raw.fallback ?? 'Unsupported message',
        };
      }

      try {
        return { kind: 'custom', typeId, data: raw.content(), fallback: raw.fallback };
      } catch {
        return { kind: 'unsupported', typeId, fallback: raw.fallback ?? 'Unsupported message' };
      }
    }

    return {
      kind: 'unsupported',
      typeId: parseTypeId(contentTypeId),
      fallback: raw.fallback ?? 'Unsupported message',
    };
  }
}

function toXmtpId(id: ConversationId): XmtpConversationId {
  return id as XmtpConversationId;
}

function parseTypeId(contentTypeId: string): string {
  const afterAuthority = contentTypeId.split('/').pop() ?? contentTypeId;
  return afterAuthority.split(':')[0];
}

function mapRole(level: 'member' | 'admin' | 'super_admin' | undefined): GroupRole {
  if (level === 'super_admin') return 'owner';
  if (level === 'admin') return 'admin';
  return 'member';
}

function mapConsent(state: ConsentState): Conversation['consent'] {
  if (state === 'allowed') return 'allowed';
  if (state === 'denied') return 'denied';
  return 'unknown';
}

function describeGroupUpdate(update: {
  membersAdded: { inboxId: string }[];
  membersRemoved: { inboxId: string }[];
  metadataFieldsChanged: { fieldName: string; newValue: string }[];
}): string {
  const parts: string[] = [];
  if (update.membersAdded.length) parts.push(`${update.membersAdded.length} joined`);
  if (update.membersRemoved.length) parts.push(`${update.membersRemoved.length} left`);
  for (const field of update.metadataFieldsChanged) {
    if (field.fieldName === 'group_name') parts.push(`Renamed to "${field.newValue}"`);
  }
  return parts.join(' · ') || 'Group updated';
}
