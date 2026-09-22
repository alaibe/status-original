import { base58 } from '@scure/base';

import {
  formatSol,
  LAMPORTS_PER_SOL,
  looksLikeSolanaAddress,
  solanaAddress,
  SOLANA_ACCOUNT_PATH,
} from './address';
import {
  checkRpcUrl,
  getBalance,
  getLatestBlockhash,
  isDefaultRpc,
  rpcUrl,
  sendTransaction,
  setRpcUrl,
  SIGNATURE_FEE,
} from './rpc';
import { fetchSplTokens } from './tokens';
import { buildTransferMessage, signTransaction } from './transaction';
import { derivationUnavailable, type ChainStrategy } from '../chains/strategy';

const badAmount = (amount: string) =>
  `"${amount}" is not a valid SOL amount. Enter a number greater than 0 using up to 9 decimal places.`;
const badRecipient = (to: string) =>
  `"${to}" is not a valid Solana recipient. Paste the recipient's full Solana address, 32 to 44 letters and numbers. An Ethereum 0x address or ENS name will not work here.`;

function toLamports(amount: string): bigint {
  if (!/^\d+(\.\d{1,9})?$/.test(amount.trim())) throw new Error(badAmount(amount));
  const [whole, fraction = ''] = amount.trim().split('.');
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, '0'));
}

const EXPLORER = 'https://solscan.io/account';

export const solanaStrategy: ChainStrategy = {
  id: 'solana',
  name: 'Solana',
  icon: 'sunny-outline',
  selfAddress: (context) => solanaAddress(context.identity.deriveEd25519(SOLANA_ACCOUNT_PATH)),
  isAddress: looksLikeSolanaAddress,
  addressHint: 'Solana address',
  unavailable: derivationUnavailable('Solana'),

  async fees() {
    return {
      headline: `${formatSol(SIGNATURE_FEE)} SOL`,
      label: 'Per signature',
      caption: 'A plain transfer carries one signature',
      rows: [{ label: 'Network', value: 'Solana' }],
      note:
        'Fixed by the protocol, so it does not move with congestion. ' +
        'A busy validator may still want a priority fee on top, which this app does not add.',
    };
  },

  async balance(_context, address) {
    return formatSol(await getBalance(rpcUrl(), address));
  },

  async holdings(_context, address) {
    const tokens = await fetchSplTokens(rpcUrl(), address).catch(() => []);
    return tokens.map((token) => ({ symbol: token.symbol, amount: token.amount }));
  },

  explorer: { name: 'Solscan', addressUrl: (address) => `${EXPLORER}/${address}` },

  transfer: {
    symbol: 'SOL',
    async quote(context, { amount, to }) {
      if (!looksLikeSolanaAddress(to)) return { error: badRecipient(to) };

      let lamports: bigint;
      try {
        lamports = toLamports(amount);
      } catch {
        return { error: badAmount(amount) };
      }
      if (lamports === 0n) return { error: 'Enter a SOL amount greater than 0, using up to 9 decimal places.' };

      const from = solanaAddress(context.identity.deriveEd25519(SOLANA_ACCOUNT_PATH));
      const balance = await getBalance(rpcUrl(), from);

      if (balance < lamports + SIGNATURE_FEE) {
        return {
          error:
            `Not enough SOL on Solana. You hold ${formatSol(balance)} SOL and this needs ` +
            `${formatSol(lamports)} SOL plus ${formatSol(SIGNATURE_FEE)} SOL in fees. Lower the amount to leave room for the fee, or add SOL on Solana.`,
        };
      }

      return {
        symbol: 'SOL',
        rows: [
          { label: 'Network', value: 'Solana' },
          { label: 'Fee', value: `${formatSol(SIGNATURE_FEE)} SOL` },
          { label: 'Balance after', value: `${formatSol(balance - lamports - SIGNATURE_FEE)} SOL` },
        ],
      };
    },
    async commit(context, { amount, to }) {
      if (!looksLikeSolanaAddress(to)) throw new Error(badRecipient(to));
      const key = context.identity.deriveEd25519(SOLANA_ACCOUNT_PATH);
      const url = rpcUrl();
      const message = buildTransferMessage({
        from: key.publicKey,
        to: base58.decode(to),
        lamports: toLamports(amount),
        blockhash: await getLatestBlockhash(url),
      });
      return sendTransaction(url, signTransaction(message, key.privateKey));
    },
  },
  endpoint: {
    current: async () => rpcUrl(),
    isDefault: isDefaultRpc,
    set: setRpcUrl,
    check: checkRpcUrl,
    noun: 'endpoint',
  },
};
