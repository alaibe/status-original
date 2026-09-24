import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { Conversation } from '@/core/messaging/types';

import { displayNames, readyChat, whenAccountReady, type CliHandler } from '../context';
import { CliError } from '../errors';
import { resolveAllOn, resolveOn } from './people';

async function group(ref: string) {
  const chat = await readyChat(ref);
  if (chat.kind === 'dm')
    throw new CliError(`${chat.label} is a direct message, not a group.`, 'usage');
  return chat;
}

function memberAction(
  run: (chat: Conversation, member: string) => Promise<void>,
  done: string
): CliHandler {
  return async ({ args }) => {
    const chat = await group(args.chat!);
    await run(chat, args.member!);
    return { data: { chat: chat.id, member: args.member }, text: `${done}.` };
  };
}

function joinRequestAction(approve: boolean): CliHandler {
  return async ({ args }) => {
    const chat = await group(args.chat!);
    await useChatStore.getState().processJoinRequest(chat.id, args.user!, approve);
    return {
      data: { chat: chat.id, user: args.user, approved: approve },
      text: approve ? 'Approved.' : 'Declined.',
    };
  };
}

export const groupHandlers = {
  async 'group create'({ args, rest, flags }) {
    await whenAccountReady();
    if (rest.length === 0) throw new CliError('Name at least one member.', 'usage');
    const { network } = await resolveOn(flags.network, rest[0]);
    const members = await resolveAllOn(network, rest);
    const chat = await useChatStore.getState().startGroup(network, members, args.title!);
    return {
      data: { id: chat.id, title: chat.title, network },
      text: `Created ${chat.title}  ${chat.id}`,
    };
  },

  async 'group members'({ args }) {
    const chat = await group(args.chat!);
    const members = await useChatStore.getState().getMembers(chat.id);
    const names = await displayNames(
      chat.protocol,
      members.map((m) => m.id)
    );
    const self = selfIdFor(useChatStore.getState(), chat.protocol);
    const data = members.map((m) => ({
      ...m,
      name: m.id === self ? 'You' : (names[m.id] ?? m.id),
    }));
    return {
      data,
      text: data.map((m) => `${m.name}  ${m.role}${m.muted ? ', muted' : ''}  ${m.id}`),
    };
  },

  async 'group add'({ args, rest }) {
    const chat = await group(args.chat!);
    const members = await resolveAllOn(chat.protocol!, rest);
    await useChatStore.getState().addMembers(chat.id, members);
    return { data: { chat: chat.id, added: members }, text: `Added ${members.length}.` };
  },

  async 'group remove'({ args, rest }) {
    const chat = await group(args.chat!);
    await useChatStore.getState().removeMembers(chat.id, rest);
    return { data: { chat: chat.id, removed: rest }, text: `Removed ${rest.length}.` };
  },

  'group ban': memberAction(
    (chat, member) => useChatStore.getState().banMember(chat.id, member),
    'Banned'
  ),
  'group mute': memberAction(
    (chat, member) => useChatStore.getState().setMemberMuted(chat.id, member, true),
    'Muted'
  ),
  'group unmute': memberAction(
    (chat, member) => useChatStore.getState().setMemberMuted(chat.id, member, false),
    'Unmuted'
  ),

  async 'group rename'({ args }) {
    const chat = await group(args.chat!);
    await useChatStore.getState().renameGroup(chat.id, args.title!);
    return { data: { chat: chat.id, title: args.title }, text: `Renamed to ${args.title}.` };
  },

  async 'group leave'({ args }) {
    const chat = await group(args.chat!);
    await useChatStore.getState().leaveGroup(chat.id);
    return { data: { chat: chat.id, left: true }, text: `Left ${chat.label}.` };
  },

  async 'group slowmode'({ args }) {
    const chat = await group(args.chat!);
    const seconds = Number(args.seconds);
    if (!Number.isInteger(seconds) || seconds < 0)
      throw new CliError('Give whole seconds, 0 or more.', 'usage');
    await useChatStore.getState().setSlowModeDelay(chat.id, seconds);
    return {
      data: { chat: chat.id, seconds },
      text: seconds ? `Slow mode: ${seconds}s.` : 'Slow mode off.',
    };
  },

  async 'group invite-link'({ args, flags }) {
    const chat = await group(args.chat!);
    const link = await useChatStore.getState().createInviteLink(chat.id, Boolean(flags.approval));
    return { data: { chat: chat.id, link }, text: link };
  },

  async 'group requests'({ args }) {
    const chat = await group(args.chat!);
    const requests = await useChatStore.getState().getJoinRequests(chat.id);
    return {
      data: requests.map((r) => ({ ...r, requestedAt: new Date(r.requestedAt).toISOString() })),
      text: requests.length
        ? requests.map((r) => `${r.name}  ${r.userId}${r.bio ? `  ${r.bio}` : ''}`)
        : 'No requests.',
    };
  },

  'group approve': joinRequestAction(true),
  'group decline': joinRequestAction(false),

  async join({ args, flags }) {
    await whenAccountReady();
    const store = useChatStore.getState();
    const networks =
      typeof flags.network === 'string' ? [flags.network] : Object.keys(store.sessions);
    let lastError: unknown;
    for (const network of networks) {
      const session = store.sessions[network];
      if (!session?.previewPublicChat) continue;
      let preview;
      try {
        preview = await store.previewPublicChat(network, args.link!);
      } catch (error) {
        lastError = error;
        continue;
      }
      const data = { network, ...preview };
      const summary = `${preview.title} (${preview.kind}${preview.memberCount ? `, ${preview.memberCount} members` : ''})`;
      if (flags.preview || preview.joined) {
        return { data, text: preview.joined ? `Already in ${summary}.` : summary };
      }
      if (preview.joinUnavailableReason) throw new CliError(preview.joinUnavailableReason);
      const chat = await store.joinPublicChat(network, preview.id);
      return {
        data: { ...data, joined: Boolean(chat), chat: chat?.id },
        text: chat ? `Joined ${summary}  ${chat.id}` : `Asked to join ${summary}.`,
      };
    }
    throw new CliError(
      lastError instanceof Error ? lastError.message : `Nothing public matches "${args.link}".`,
      'notFound'
    );
  },
} satisfies Record<string, CliHandler>;
