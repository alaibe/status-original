import { hexToString, isHex, type Address, type Hex } from 'viem';

import type { PluginContext } from '@/core/plugins/types';
import { fromCaip2 } from '@/lib/evm/chains';
import { walletClientFor } from '@/lib/evm/wallet';

import type { PendingItem } from './walletconnect';

export async function handleSessionRequest(
  item: Extract<PendingItem, { kind: 'request' }>,
  context: PluginContext
): Promise<unknown> {
  const account = context.identity.account();

  switch (item.method) {
    case 'eth_accounts':
      return [account.address];

    case 'personal_sign': {
      const [rawMessage] = item.params as [Hex | string, Address];
      const message = isHex(rawMessage) ? hexToString(rawMessage) : String(rawMessage);
      return account.signMessage({ message });
    }

    case 'eth_sign': {
      const [, rawMessage] = item.params as [Address, Hex | string];
      const message = isHex(rawMessage) ? hexToString(rawMessage) : String(rawMessage);
      return account.signMessage({ message });
    }

    case 'eth_signTypedData':
    case 'eth_signTypedData_v4': {
      const [, payload] = item.params as [Address, string | object];
      const typedData = typeof payload === 'string' ? JSON.parse(payload) : payload;
      return account.signTypedData(typedData);
    }

    case 'eth_sendTransaction': {
      const [tx] = item.params as [
        { to: Address; value?: Hex; data?: Hex; gas?: Hex },
      ];

      const chainId = resolveChainId(item.chainId);
      const client = walletClientFor(account, chainId);

      return client.sendTransaction({
        account,
        chain: null,
        to: tx.to,
        value: tx.value ? BigInt(tx.value) : undefined,
        data: tx.data,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      });
    }

    default:
      throw new Error(`${item.method} is not supported by this wallet`);
  }
}

export function describeRequest(item: Extract<PendingItem, { kind: 'request' }>): {
  title: string;
  detail: string;
} {
  switch (item.method) {
    case 'personal_sign':
    case 'eth_sign': {
      const raw = item.method === 'personal_sign' ? item.params[0] : item.params[1];
      const text = isHex(raw as Hex) ? hexToString(raw as Hex) : String(raw);
      return { title: 'Sign message', detail: text.slice(0, 400) };
    }

    case 'eth_signTypedData':
    case 'eth_signTypedData_v4': {
      const payload = item.params[1];
      const parsed = typeof payload === 'string' ? safeParse(payload) : payload;
      const primaryType =
        parsed && typeof parsed === 'object' && 'primaryType' in parsed
          ? String((parsed as { primaryType: unknown }).primaryType)
          : 'data';
      return { title: 'Sign typed data', detail: `Structured ${primaryType} payload` };
    }

    case 'eth_sendTransaction': {
      const tx = item.params[0] as { to?: string; value?: Hex };
      const value = tx?.value ? Number(BigInt(tx.value)) / 1e18 : 0;
      return {
        title: 'Send transaction',
        detail: `${value} to ${tx?.to ?? 'unknown address'}`,
      };
    }

    default:
      return { title: item.method, detail: 'Unrecognised request' };
  }
}

function resolveChainId(caip2: string): number {
  const chainId = fromCaip2(caip2);
  if (chainId === null) {
    throw new Error(`Unsupported network "${caip2}" for this transaction.`);
  }
  return chainId;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
