import {
  BaseError,
  ExecutionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  LimitExceededRpcError,
  TimeoutError,
  UserRejectedRequestError,
} from 'viem';

import { errorMessage } from '@/core/errors';

import type { ChainStrategy } from './chains/strategy';

/** `before`: nothing has been signed. `after`: it may have been broadcast. `lookup`: a read. */
const ACTIONS = {
  review: { verb: 'review this transfer', stage: 'before' },
  send: { verb: 'complete this payment', stage: 'after' },
  balance: { verb: 'load the balance', stage: 'lookup' },
  fees: { verb: 'load network fees', stage: 'lookup' },
  quote: { verb: 'quote this trade', stage: 'before' },
  trade: { verb: 'complete this trade', stage: 'after' },
  status: { verb: 'check this bridge', stage: 'lookup' },
} as const;

export function walletErrorMessage(
  error: unknown,
  chain: ChainStrategy | undefined,
  operation: keyof typeof ACTIONS
): string {
  const network = chain?.name ?? 'the selected network';
  const currency = chain?.transfer?.symbol ?? 'the native currency';
  const { verb: action, stage } = ACTIONS[operation];
  const reviewStatus = stage === 'before' ? ' Nothing was sent.' : '';
  const uncertainStatus =
    stage === 'after'
      ? ' The payment may have been submitted. Check your transaction history or the network explorer before trying again to avoid sending twice.'
      : reviewStatus;
  const causes: {
    message?: unknown;
    name?: unknown;
    code?: unknown;
    status?: unknown;
    cause?: unknown;
  }[] = [];
  const seen = new Set<object>();
  let cause = error;
  while (cause && typeof cause === 'object' && !seen.has(cause)) {
    seen.add(cause);
    const entry = cause as (typeof causes)[number];
    causes.push(entry);
    cause = entry.cause;
  }
  const text = [
    typeof error === 'string' ? error : '',
    ...causes.map((entry) =>
      entry instanceof BaseError
        ? `${entry.shortMessage}\n${entry.details ?? ''}`
        : typeof entry.message === 'string'
          ? entry.message
          : ''
    ),
  ].join('\n');
  const reverted =
    causes.some(
      (entry) =>
        entry instanceof ExecutionRevertedError || entry.code === ExecutionRevertedError.code
    ) || /execution reverted|transaction reverted|transfer reverted/i.test(text);

  if (
    causes.some(
      (entry) =>
        entry instanceof LimitExceededRpcError ||
        entry.status === 429 ||
        entry.code === 429 ||
        entry.code === -32005
    ) ||
    /rate[ -]?limit|too many requests|(?:\b(?:HTTP(?: error| status)?|status:?)\s+|\bfailed \(|\breturned )429\b/i.test(
      text
    )
  ) {
    return `A network service is limiting requests, so we could not ${action} on ${network}. Wait for the limit to reset.${uncertainStatus}`;
  }
  if (
    causes.some((entry) => entry instanceof InsufficientFundsError) ||
    (!reverted &&
      /out[ _-]?of[ _-]?funds|insufficient (?:funds|balance|lamports)|not enough (?:funds|balance|lamports)|exceeds (?:the )?(?:transaction sender account )?balance/i.test(
        text
      ))
  ) {
    return `Not enough ${currency} on ${network} for this transfer. Add ${currency} on ${network} and keep enough for network fees. Funds on other networks cannot pay these fees.${reviewStatus}`;
  }
  if (
    causes.some((entry) => entry.code === 4902) ||
    /unsupported (?:chain|network)|(?:chain|network)[^\n]*\b(?:not supported|not available in this app|not configured)\b/i.test(
      text
    )
  ) {
    return `${network} is not available for this operation in this app. Choose another supported network with /networks.${reviewStatus}`;
  }
  if (
    causes.some((entry) => entry instanceof UserRejectedRequestError || entry.code === 4001) ||
    /\buser (?:rejected|denied|cancell?ed)\b|\bauthentication (?:was )?cancell?ed\b/i.test(text)
  ) {
    return `The ${network} request was cancelled. Review the request details and approve only if you want to continue.${reviewStatus}`;
  }
  if (reverted) {
    if (stage === 'lookup') {
      return `Could not ${action} on ${network} because the network rejected the lookup. Check the selected network and token, then try the lookup again.`;
    }
    return stage === 'before'
      ? `This transfer would be rejected on ${network}. Check the recipient, amount and token; the recipient contract may not accept this transfer. Nothing was sent.`
      : `The transfer was rejected or reverted on ${network}. Check the recipient, amount and token before continuing; a reverted transaction may still cost ${currency} in network fees.`;
  }
  if (
    /invalid (?:recipient|address)|(?:recipient|address)[^\n]*(?:is not valid|is invalid)|is not (?:an? )?(?:\w+ )?address/i.test(
      text
    )
  ) {
    return `The recipient is not a valid address for ${network}. Check and correct the full recipient address, and confirm it belongs to this network.${reviewStatus}`;
  }
  if (
    causes.some((entry) => entry.status === 401 || entry.status === 403) ||
    /(?:\b(?:HTTP(?: error| status)?|status:?)\s+|\bfailed \(|\breturned )(?:401|403)\b/i.test(text)
  ) {
    return `The network service denied access while trying to ${action} on ${network}. Check the endpoint URL and access key in ${chain ? `/rpc --chain ${chain.id}` : 'the network settings'}.${uncertainStatus}`;
  }
  if (
    causes.some((entry) => entry instanceof TimeoutError || entry.code === 'ETIMEDOUT') ||
    /timed?\s*out|timeout/i.test(text)
  ) {
    return `A network service did not respond in time, so we could not ${action} on ${network}. Check your connection and wait for the service to recover.${uncertainStatus}`;
  }
  if (
    causes.some(
      (entry) =>
        entry instanceof HttpRequestError ||
        entry.code === 4900 ||
        entry.code === 4901 ||
        entry.name === 'AbortError' ||
        /^(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|ENETUNREACH)$/.test(String(entry.code))
    ) ||
    /fetch failed|failed to fetch|network request failed|network error|offline|connection (?:closed|failed|lost)|socket (?:closed|hang up)|HTTP request failed|\bHTTP(?: error| status)?\s*\d{3}\b|\b(?:failed \(|returned )(?:408|5\d{2})/i.test(
      text
    )
  ) {
    return `Could not ${action} on ${network} because a network service could not be reached. Check your internet connection and wait for the service to recover.${uncertainStatus}`;
  }

  const ordinary = errorMessage(error, '').trim();
  const diagnostic =
    causes.some((entry) => entry instanceof BaseError || typeof entry.code === 'number') ||
    /(?:https?|wss?):\/\/|\b(?:rpc|json|stack|authorization|bearer|api[ _-]?key|password|secret|credential)\b|request body|\b(?:url|headers|details|version):|\bviem@|\bat \S+\s*\(|transaction creation failed/i.test(
      text
    );
  if (ordinary && !diagnostic) return `${ordinary}${uncertainStatus}`;
  return `Could not ${action} on ${network} because the network service returned an unexpected error. Check the selected network and wait for the service to recover.${uncertainStatus}`;
}

export function sentPaymentErrorMessage(chainName: string, hash: string, noun = 'payment'): string {
  return `Your ${noun} was sent on ${chainName}, but its confirmation could not be posted in the chat. Do not send it again. Check the network explorer for its status. Transaction hash: ${hash}`;
}
