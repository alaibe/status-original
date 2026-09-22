import { Core } from '@walletconnect/core';
import { WalletKit, type WalletKitTypes } from '@reown/walletkit';
import type { SessionTypes } from '@walletconnect/types';
import { buildApprovedNamespaces, getSdkError, parseUri } from '@walletconnect/utils';
import { create } from 'zustand';

import type { PluginContext } from '@/core/plugins/types';
import { SUPPORTED_CHAINS, toCaip2 } from '@/lib/evm/chains';

import { APP_METADATA, walletConnectProjectId } from './config';
import { errorMessage } from '@/core/errors';

export const SUPPORTED_METHODS = [
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'eth_accounts',
  'eth_chainId',
] as const;

export const SUPPORTED_EVENTS = ['chainChanged', 'accountsChanged'] as const;

type Kit = Awaited<ReturnType<typeof WalletKit.init>>;

export type PendingItem =
  | { kind: 'proposal'; id: number; proposal: WalletKitTypes.SessionProposal }
  | {
      kind: 'request';
      id: number;
      topic: string;
      method: string;
      params: unknown[];
      chainId: string;
      siteName: string;
    };

interface WalletConnectState {
  kit: Kit | null;
  initializing: boolean;
  error: string | null;
  queue: PendingItem[];
  /** True while the QR scanner is on screen. The camera runs only then. */
  scanning: boolean;

  setScanning(scanning: boolean): void;
  init(context: PluginContext): Promise<void>;
  pair(uri: string): Promise<void>;
  /** Ends one pairing. The site has to pair again to ask for anything. */
  disconnectSession(topic: string): Promise<void>;
  approveHead(context: PluginContext): Promise<void>;
  rejectHead(): Promise<void>;
  shutdown(): Promise<void>;
}

let onProposal: ((p: WalletKitTypes.SessionProposal) => void) | null = null;
let onRequest: ((e: WalletKitTypes.SessionRequest) => void) | null = null;
let onDelete: (() => void) | null = null;

function redirectOf(peer: SessionTypes.Struct['peer']['metadata']) {
  return peer.redirect?.native || peer.redirect?.universal;
}

async function returnAfterPairing(
  peer: SessionTypes.Struct['peer']['metadata'],
  context: PluginContext
) {
  const target = redirectOf(peer) || peer.url;
  if (target) await context.ui.openExternalUrl(target).catch(() => {});
}

async function returnAfterRequest(
  peer: SessionTypes.Struct['peer']['metadata'],
  context: PluginContext
) {
  const target = redirectOf(peer);
  if (target) {
    context.ui.notify('Approved', 'success');
    await context.ui.openExternalUrl(target).catch(() => {});
    return;
  }
  context.ui.notify(`Approved. Switch back to ${peer.name || 'the site'} to carry on.`, 'success');
}

function isPairingUri(uri: string) {
  try {
    const { version, topic, symKey, relay } = parseUri(uri);
    return version === 2 && /^[0-9a-f]{64}$/i.test(topic) && !!symKey && relay.protocol === 'irn';
  } catch {
    return false;
  }
}

export const useWalletConnectStore = create<WalletConnectState>((set, get) => ({
  kit: null,
  initializing: false,
  error: null,
  queue: [],
  scanning: false,

  setScanning(scanning) {
    set({ scanning });
  },

  async init(context) {
    if (get().kit || get().initializing) return;

    const projectId = walletConnectProjectId();
    if (!projectId) {
      set({
        error:
          'WalletConnect needs a free project id. Add one to app.json under ' +
          'expo.extra.walletConnectProjectId, or set ' +
          'EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID.',
      });
      return;
    }

    set({ initializing: true, error: null });
    try {
      const core = new Core({ projectId });
      const kit = await WalletKit.init({ core, metadata: APP_METADATA });

      onProposal = (proposal: WalletKitTypes.SessionProposal) => {
        set((s) => ({
          queue: [...s.queue, { kind: 'proposal', id: proposal.id, proposal }],
        }));
      };

      onRequest = (event: WalletKitTypes.SessionRequest) => {
        const session = kit.getActiveSessions()[event.topic];
        set((s) => ({
          queue: [
            ...s.queue,
            {
              kind: 'request',
              id: event.id,
              topic: event.topic,
              method: event.params.request.method,
              params: event.params.request.params as unknown[],
              chainId: event.params.chainId,
              siteName: session?.peer.metadata.name ?? 'A site',
            },
          ],
        }));
      };

      onDelete = () => {};

      kit.on('session_proposal', onProposal);
      kit.on('session_request', onRequest);
      kit.on('session_delete', onDelete);

      set({ kit, initializing: false });
    } catch (error) {
      set({ initializing: false, error: errorMessage(error, 'Could not start WalletConnect') });
    }
  },

  async pair(uri) {
    const kit = get().kit;
    if (!kit) throw new Error(get().error ?? 'WalletConnect is still starting up.');
    if (!isPairingUri(uri)) {
      throw new Error('That is not a whole pairing link. Copy it again from the site.');
    }
    try {
      await kit.pair({ uri });
    } catch (error) {
      const reason = errorMessage(error, '');
      if (reason.includes('Pairing already exists') || reason.includes('expired')) {
        throw new Error(
          'That link is spent. Ask the site for a fresh code, then scan or paste it again.'
        );
      }
      throw error;
    }
  },

  async disconnectSession(topic) {
    const kit = get().kit;
    if (!kit) return;
    await kit.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') });
  },

  async approveHead(context) {
    const kit = get().kit;
    const head = get().queue[0];
    if (!kit || !head) return;

    try {
      if (head.kind === 'proposal') {
        const address = context.identity.address;
        const chains = SUPPORTED_CHAINS.map((c) => toCaip2(c.id));

        const namespaces = buildApprovedNamespaces({
          proposal: head.proposal.params,
          supportedNamespaces: {
            eip155: {
              chains,
              methods: [...SUPPORTED_METHODS],
              events: [...SUPPORTED_EVENTS],
              accounts: chains.map((chain) => `${chain}:${address}`),
            },
          },
        });

        const session = await kit.approveSession({ id: head.id, namespaces });
        context.ui.notify('Connected', 'success');
        await returnAfterPairing(session.peer.metadata, context);
      } else {
        const { handleSessionRequest } = await import('./rpc');
        const result = await handleSessionRequest(head, context);
        await kit.respondSessionRequest({
          topic: head.topic,
          response: { id: head.id, jsonrpc: '2.0', result },
        });
        const session = kit.getActiveSessions()[head.topic];
        if (session) await returnAfterRequest(session.peer.metadata, context);
        else context.ui.notify('Approved', 'success');
      }
    } catch (error) {
      const message = errorMessage(error, 'Request failed');
      context.ui.notify(message, 'error');

      if (head.kind === 'request') {
        await kit
          .respondSessionRequest({
            topic: head.topic,
            response: {
              id: head.id,
              jsonrpc: '2.0',
              error: { code: 5000, message },
            },
          })
          .catch(() => {});
      }
    } finally {
      set((s) => ({ queue: s.queue.slice(1) }));
    }
  },

  async rejectHead() {
    const kit = get().kit;
    const head = get().queue[0];
    if (!kit || !head) return;

    try {
      if (head.kind === 'proposal') {
        await kit.rejectSession({ id: head.id, reason: getSdkError('USER_REJECTED') });
      } else {
        await kit.respondSessionRequest({
          topic: head.topic,
          response: {
            id: head.id,
            jsonrpc: '2.0',
            error: getSdkError('USER_REJECTED'),
          },
        });
      }
    } finally {
      set((s) => ({ queue: s.queue.slice(1) }));
    }
  },

  async shutdown() {
    const kit = get().kit;
    if (kit) {
      if (onProposal) kit.off('session_proposal', onProposal);
      if (onRequest) kit.off('session_request', onRequest);
      if (onDelete) kit.off('session_delete', onDelete);
    }
    onProposal = onRequest = onDelete = null;
    set({ kit: null, queue: [] });
  },
}));
