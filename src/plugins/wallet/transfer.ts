import type { ConversationId } from '@/core/messaging/types';
import type { PluginContext } from '@/core/plugins/types';

import type { ChainStrategy, TransferParams } from './chains/strategy';
import { sentPaymentErrorMessage, walletErrorMessage } from './errors';
import { CONTENT_TYPE_PAYMENT_RECEIPT, type PaymentReceipt } from './types';

export function networkOffMessage(label: string): string {
  return `${label} is turned off. Open Wallet and use /networks to turn it on before paying.`;
}

export type CommitOutcome = { ok: true; hash: string } | { ok: false; message: string };

/**
 * Signs and broadcasts, then posts a receipt when there is a conversation to
 * post it in. Once the transfer is on the network a later failure must never
 * read as "try again", so it gets the sent-but-unconfirmed message instead.
 */
export async function commitTransfer(
  chain: ChainStrategy,
  context: PluginContext,
  params: TransferParams,
  {
    conversationId,
    symbol = chain.transfer!.symbol,
    onSent,
  }: {
    conversationId?: ConversationId;
    symbol?: string;
    onSent?: (hash: string) => void | Promise<void>;
  } = {}
): Promise<CommitOutcome> {
  let hash: string | undefined;
  try {
    hash = await chain.transfer!.commit(context, params);
    await onSent?.(hash);

    if (conversationId) {
      const receipt: PaymentReceipt = {
        hash,
        chain: chain.id,
        amount: params.amount,
        symbol,
        to: params.to,
      };
      await context.chat.sendCustom(conversationId, CONTENT_TYPE_PAYMENT_RECEIPT, receipt);
    }
    return { ok: true, hash };
  } catch (error) {
    return {
      ok: false,
      message:
        hash === undefined
          ? walletErrorMessage(error, chain, 'send')
          : sentPaymentErrorMessage(chain.name, hash),
    };
  }
}
