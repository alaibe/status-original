import { jsonRpc } from '@/lib/json-rpc';

import { createEndpointSetting } from '@/core/plugins/endpoint-setting';
import type { RpcCheck } from '../chains/strategy';

const endpoint = createEndpointSetting({
  key: 'solana-rpc',
  fallback: 'https://api.mainnet-beta.solana.com',
});

export const rpcUrl = endpoint.current;
export const hydrateRpcUrl = endpoint.hydrate;
export const setRpcUrl = endpoint.save;
export const isDefaultRpc = endpoint.isDefault;

export async function getBalance(url: string, address: string): Promise<bigint> {
  const result = await jsonRpc<{ value: number }>(url, 'getBalance', [address]);
  return BigInt(result.value);
}

export const SIGNATURE_FEE = 5_000n;

export async function getLatestBlockhash(url: string): Promise<string> {
  const result = await jsonRpc<{ value: { blockhash: string } }>(url, 'getLatestBlockhash', [
    { commitment: 'finalized' },
  ]);
  return result.value.blockhash;
}

export async function sendTransaction(url: string, signed: Uint8Array): Promise<string> {
  const base64 = btoa(String.fromCharCode(...signed));
  return jsonRpc<string>(url, 'sendTransaction', [
    base64,
    { encoding: 'base64', preflightCommitment: 'confirmed' },
  ]);
}

export async function checkRpcUrl(url: string): Promise<RpcCheck> {
  if (!/^https?:\/\//.test(url)) return { ok: false, reason: 'That needs to be an http(s) URL.' };
  try {
    const version = await jsonRpc<{ 'solana-core': string }>(url, 'getVersion', []);
    return version['solana-core']
      ? { ok: true }
      : { ok: false, reason: 'That endpoint did not answer like a Solana node.' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Could not reach it.' };
  }
}
