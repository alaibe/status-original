import { router } from 'expo-router';

import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { Conversation, GroupRole } from '@/core/messaging/types';
import { nameFrom, resolveParticipants } from '@/core/messaging/display-names';
import type { ComposerAction, SlashCommand } from '@/core/plugins/types';
import { W } from '@/design/widgets';

// The registry only offers these in a group, so the guard is just "is it still here".
function groupGuard(
  conversationId: string
): { ok: true; conversation: Conversation; selfRole: GroupRole } | { ok: false; message: string } {
  const conversation = useChatStore.getState().conversations.find((c) => c.id === conversationId);

  if (!conversation) return { ok: false, message: 'Conversation not found.' };
  return { ok: true, conversation, selfRole: conversation.selfRole ?? 'member' };
}

async function resolveOn(
  conversation: Conversation,
  who: string
): Promise<{ ok: true; participantId: string | null } | { ok: false; message: string }> {
  const state = useChatStore.getState();
  const { protocol } = conversation;
  if (!protocol || !state.sessions[protocol]) return { ok: false, message: 'Not connected yet.' };
  return { ok: true, participantId: await state.resolvePeer(protocol, who) };
}

async function membersCard(conversationId: string, note?: string) {
  const conversation = useChatStore.getState().conversations.find((c) => c.id === conversationId);
  const protocol = conversation?.protocol;
  const members = await useChatStore.getState().getMembers(conversationId);
  const selfId = selfIdFor(useChatStore.getState(), protocol);
  const resolved = await resolveParticipants(
    protocol,
    members.map((m) => m.id)
  );

  const selfRole = conversation?.selfRole ?? 'member';

  return {
    kind: 'widget' as const,
    fallback: note ?? `${members.length} members`,
    widget: W.card(
      [
        W.rows(
          members.map((m) => {
            const isSelf = m.id === selfId;
            return {
              label: isSelf ? 'You' : nameFrom(m.id, resolved),
              value: m.role,
              tone: m.role === 'member' ? undefined : ('brand' as const),
              actions: isSelf
                ? [{ label: 'Leave this group', command: '/leave', tone: 'danger' as const }]
                : [{ label: 'View profile', command: `/profile ${m.id}` }],
            };
          })
        ),
        W.text(
          note ??
            (selfRole === 'member'
              ? 'You are a member. Admins can add and remove people.'
              : `You are ${selfRole === 'owner' ? 'the owner' : 'an admin'}. /invite and /remove are available.`)
        ),
      ],
      { title: `${members.length} members`, icon: 'people-outline' }
    ),
  };
}

export const groupCommands: SlashCommand[] = [
  {
    name: 'profile',
    description: "Open a member's profile",
    showIn: ['group', 'dm'],
    usage: '/profile [member]',
    async run({ args, conversationId }) {
      const [member] = args;
      // Core commands are handed a context that throws on any access, so this
      // goes through the imperative router.
      router.push({
        pathname: '/profile/[id]',
        params: member ? { id: conversationId, member } : { id: conversationId },
      });
      return { type: 'handled' };
    },
  },

  {
    name: 'members',
    aliases: ['who'],
    description: 'Who is in this group',
    showIn: ['group'],
    usage: '/members',
    async run({ conversationId, respond }) {
      const guard = groupGuard(conversationId);
      if (!guard.ok) return { type: 'error', message: guard.message };

      await respond(await membersCard(conversationId));
      return { type: 'handled' };
    },
  },

  {
    name: 'invite',
    aliases: ['add'],
    description: 'Add someone to this group',
    showIn: ['group'],
    usage: '/invite <address | name.eth>',
    async run({ args, conversationId, respond }) {
      const guard = groupGuard(conversationId);
      if (!guard.ok) return { type: 'error', message: guard.message };
      if (guard.selfRole === 'member') {
        return { type: 'error', message: 'Only admins can add people to this group.' };
      }

      const [who] = args;
      if (!who) return { type: 'error', message: 'Who? /invite vitalik.eth' };

      const resolved = await resolveOn(guard.conversation, who);
      if (!resolved.ok) return { type: 'error', message: resolved.message };
      const { participantId } = resolved;
      if (!participantId) {
        return {
          type: 'error',
          message: `${who} has no XMTP inbox yet, so they cannot be added.`,
        };
      }

      await useChatStore.getState().addMembers(conversationId, [participantId]);
      await respond(
        await membersCard(conversationId, `Added ${who}. Everyone in the group sees the change.`)
      );
      return { type: 'handled' };
    },
  },

  {
    name: 'remove',
    aliases: ['kick'],
    description: 'Remove someone from this group',
    showIn: ['group'],
    usage: '/remove <address | inbox id>',
    async run({ args, conversationId, respond }) {
      const guard = groupGuard(conversationId);
      if (!guard.ok) return { type: 'error', message: guard.message };
      if (guard.selfRole === 'member') {
        return { type: 'error', message: 'Only admins can remove people from this group.' };
      }

      const [who] = args;
      if (!who) return { type: 'error', message: 'Who? /remove 0xabc…' };

      const resolved = await resolveOn(guard.conversation, who);
      if (!resolved.ok) return { type: 'error', message: resolved.message };
      const { participantId } = resolved;
      if (!participantId) return { type: 'error', message: `Could not resolve ${who}.` };
      if (participantId === selfIdFor(useChatStore.getState(), guard.conversation.protocol)) {
        return { type: 'error', message: 'Use /leave to remove yourself.' };
      }

      await useChatStore.getState().removeMembers(conversationId, [participantId]);
      await respond(
        await membersCard(
          conversationId,
          `Removed ${who}. They keep messages they already had. MLS re-keys the group ` +
            'so they cannot read anything sent from now on.'
        )
      );
      return { type: 'handled' };
    },
  },

  {
    name: 'rename',
    description: 'Rename this group',
    showIn: ['group'],
    usage: '/rename <new name>',
    async run({ rest, conversationId, respond }) {
      const guard = groupGuard(conversationId);
      if (!guard.ok) return { type: 'error', message: guard.message };

      const title = rest.trim();
      if (!title) return { type: 'error', message: 'Call it what? /rename Weekend plans' };

      await useChatStore.getState().renameGroup(conversationId, title);
      await respond(`Renamed to "${title}".`);
      return { type: 'handled' };
    },
  },

  {
    name: 'leave',
    description: 'Leave this group',
    showIn: ['group'],
    usage: '/leave',
    async run({ conversationId }) {
      const guard = groupGuard(conversationId);
      if (!guard.ok) return { type: 'error', message: guard.message };

      await useChatStore.getState().leaveGroup(conversationId);
      return { type: 'notice', message: 'You left the group. Rejoining needs a fresh invite.' };
    },
  },
];

export const groupComposerActions: ComposerAction[] = [
  {
    id: 'members',
    label: 'Members',
    icon: 'people-outline',
    command: '/members',
    showIn: ['group'],
  },
];
