import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { ParticipantId } from '@/core/messaging/types';
import { peersOf } from '@/features/contacts/peers';
import { transportProtocols } from '@/protocols';

import { chatLabels, displayNames, whenAccountReady, type CliHandler } from '../context';
import { CliError } from '../errors';
import { findNetwork } from './networks';

function connectedNetworks(flag: string | true | undefined) {
  const sessions = useChatStore.getState().sessions;
  const wanted = typeof flag === 'string' ? [findNetwork(flag)] : transportProtocols();
  const connected = wanted.filter((p) => sessions[p.id]);
  if (connected.length === 0) {
    throw new CliError(
      typeof flag === 'string'
        ? `${wanted[0].label} is not connected.`
        : 'No network is connected.',
      'unavailable'
    );
  }
  return connected;
}

/** The first network, in the app's order, that knows the peer. */
export async function resolveOn(
  flag: string | true | undefined,
  peer: string
): Promise<{ network: string; id: ParticipantId }> {
  const networks = connectedNetworks(flag);
  const store = useChatStore.getState();
  for (const network of networks) {
    const id = await store.resolvePeer(network.id, peer).catch(() => null);
    if (id) return { network: network.id, id };
  }
  const reason =
    networks.length === 1 ? networks[0].recipient.unreachable(peer) : `No network knows "${peer}".`;
  throw new CliError(reason, 'notFound');
}

export async function resolveAllOn(network: string, peers: string[]): Promise<ParticipantId[]> {
  const store = useChatStore.getState();
  return Promise.all(
    peers.map(async (peer) => {
      const id = await store.resolvePeer(network, peer).catch(() => null);
      if (!id) throw new CliError(findNetwork(network).recipient.unreachable(peer), 'notFound');
      return id;
    })
  );
}

export const peopleHandlers = {
  async new({ args, flags }) {
    await whenAccountReady();
    const { network, id } = await resolveOn(flags.network, args.peer!);
    const chat = await useChatStore.getState().startDm(network, id);
    const title = (await chatLabels([chat])).get(chat.id)?.title ?? chat.title;
    return {
      data: { id: chat.id, title, network },
      text: `Chat ready: ${title}  ${chat.id}`,
    };
  },

  async resolve({ args, flags }) {
    await whenAccountReady();
    const found = await resolveOn(flags.network, args.peer!);
    return { data: found, text: `${found.network}: ${found.id}` };
  },

  async contacts({ flags }) {
    await whenAccountReady();
    const state = useChatStore.getState();
    const network = typeof flags.network === 'string' ? findNetwork(flags.network).id : undefined;
    const peers = peersOf(state.conversations, (p) => selfIdFor(state, p)).filter(
      (p) => !network || p.protocol === network
    );
    const names: Record<string, string> = {};
    for (const protocol of new Set(peers.map((p) => p.protocol))) {
      Object.assign(
        names,
        await displayNames(
          protocol,
          peers.filter((p) => p.protocol === protocol).map((p) => p.id)
        )
      );
    }
    const data = peers
      .map((p) => ({
        id: p.id,
        name: names[p.id] ?? p.id,
        network: p.protocol,
        chat: p.conversationId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      data,
      text: data.length
        ? data.map((p) => `${p.name}  (${p.network})  ${p.chat}`)
        : 'No contacts yet.',
    };
  },
} satisfies Record<string, CliHandler>;
