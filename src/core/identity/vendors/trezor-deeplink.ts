import * as Linking from 'expo-linking';
import type { Address, Hex } from 'viem';

import { stripHex } from '@/lib/bytes';

import { registerVendor, type HardwareSigner } from '../hardware';
import { canOpenExternal, openExternal } from '@/lib/open-url';

const SUITE_SCHEME = 'trezorsuitelite://';

const pending = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();

export function handleTrezorCallback(url: string): boolean {
  const query = queryOf(url);
  const id = query.get('id');
  if (!id) return false;

  const waiting = pending.get(id);
  if (!waiting) return false;
  pending.delete(id);

  const error = query.get('error');
  if (error) {
    waiting.reject(new Error(error === 'cancelled' ? 'Cancelled on the Trezor.' : error));
    return true;
  }

  const payload = query.get('payload');
  if (!payload) {
    waiting.reject(new Error('Trezor Suite returned nothing.'));
    return true;
  }

  waiting.resolve(payload);
  return true;
}

function queryOf(url: string): Map<string, string> {
  const out = new Map<string, string>();
  const at = url.indexOf('?');
  if (at === -1) return out;

  for (const pair of url.slice(at + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    out.set(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)));
  }
  return out;
}

function newRequestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function callSuite(method: string, params: Record<string, string>): Promise<string> {
  const id = newRequestId();
  const callback = Linking.createURL('trezor');

  const url =
    `${SUITE_SCHEME}connect?method=${encodeURIComponent(method)}` +
    `&id=${encodeURIComponent(id)}` +
    `&callback=${encodeURIComponent(callback)}` +
    Object.entries(params)
      .map(([key, value]) => `&${key}=${encodeURIComponent(value)}`)
      .join('');

  if (!(await canOpenExternal(SUITE_SCHEME))) {
    throw new Error('Trezor Suite is not installed on this phone.');
  }

  const answer = new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  await openExternal(url);
  return answer;
}

export function trezorSigner(): HardwareSigner {
  return {
    id: 'trezor',
    label: 'Trezor',

    async getAddress(path) {
      return (await callSuite('ethereumGetAddress', { path })) as Address;
    },

    async signMessage(path, message) {
      const signature = await callSuite('ethereumSignMessage', {
        path,
        message,
      });
      return `0x${stripHex(signature)}` as Hex;
    },

    async signTransaction(path, serialized) {
      const signature = await callSuite('ethereumSignTransaction', {
        path,
        transaction: stripHex(serialized),
      });
      return `0x${stripHex(signature)}` as Hex;
    },

    async signTypedDataHashes(path, domainHash, messageHash) {
      const signature = await callSuite('ethereumSignTypedData', {
        path,
        domain_separator_hash: stripHex(domainHash),
        message_hash: stripHex(messageHash),
      });
      return `0x${stripHex(signature)}` as Hex;
    },
  };
}

export function registerTrezor(): void {
  registerVendor({
    id: 'trezor',
    label: 'Trezor',
    connection: 'companion-app',
    async connect() {
      return trezorSigner();
    },
  });
}
