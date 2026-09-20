import { errorMessage } from '@/core/errors';
import type { BotContext } from '@/core/messaging/bots';
import type { CommandResult, PluginContext } from '@/core/plugins/types';
import type { IconName } from '@/design';
import type { Widget } from '@/design/widgets';

export type Say = BotContext['say'];

export type RpcCheck = { ok: true } | { ok: false; reason: string };

export interface TransferAsset {
  symbol: string;
  id: string;
  held?: string;
}

export interface TransferParams {
  amount: string;
  to: string;
  asset?: string;
}

export type TransferQuote =
  | { symbol: string; rows: { label: string; value: string }[] }
  | { error: string };

export interface ChainFees {
  headline: string;
  label: string;
  caption?: string;
  rows: { label: string; value: string }[];
  note?: string;
  link?: { label: string; url: string };
}

export interface ChainStrategy {
  id: string;
  name: string;
  icon: IconName;

  selfAddress(context: PluginContext): string;
  isAddress(value: string): boolean;
  resolve?(input: string): Promise<string | null>;
  addressHint: string;

  unavailable?(context: PluginContext): CommandResult | null;

  detail?(context: PluginContext, address: string): Promise<Widget[]>;

  balance?(context: PluginContext, address: string): Promise<string>;

  fees?(context: PluginContext): Promise<ChainFees>;

  explorer: {
    name: string;
    addressUrl(address: string): string;
    aliases?: string[];
  };

  transfer?: {
    symbol: string;
    assets?(context: PluginContext): Promise<TransferAsset[]>;
    quote(context: PluginContext, params: TransferParams): Promise<TransferQuote>;
    commit(context: PluginContext, params: TransferParams): Promise<string>;
  };

  endpoint: {
    current(context: PluginContext): Promise<string>;
    isDefault(url: string): boolean;
    set(context: PluginContext, url: string | null): Promise<void>;
    aliases?: string[];
    check(url: string): Promise<RpcCheck>;
    noun: string;
  };
}

const registered = new Map<string, ChainStrategy>();

export function registerChainStrategy(strategy: ChainStrategy): () => void {
  registered.set(strategy.id, strategy);
  return () => {
    if (registered.get(strategy.id) === strategy) registered.delete(strategy.id);
  };
}

export function chainStrategies(): ChainStrategy[] {
  return [...registered.values()];
}

export function sendableChains(): ChainStrategy[] {
  return chainStrategies().filter((s) => s.transfer !== undefined);
}

export type AddressLookup = { address: string } | { error: string };

export function selfAddressOf(chain: ChainStrategy, context: PluginContext): AddressLookup {
  try {
    return { address: chain.selfAddress(context) };
  } catch (error) {
    return { error: errorMessage(error, `Could not read your ${chain.name} address.`) };
  }
}

/** With `resolve`, a name is looked up through the chain's resolver; that lookup may throw. */
export async function targetAddress(
  chain: ChainStrategy,
  context: PluginContext,
  given: string | undefined,
  { resolve }: { resolve: boolean }
): Promise<AddressLookup> {
  if (!given) return selfAddressOf(chain, context);
  if (chain.isAddress(given)) return { address: given };
  if (!resolve) return { error: `"${given}" is not a ${chain.name} address.` };

  const resolved = await chain.resolve?.(given);
  return resolved
    ? { address: resolved }
    : {
        error: `"${given}" could not be resolved to a ${chain.name} address. Check the spelling or paste a full address (${chain.addressHint}).`,
      };
}

export function derivationUnavailable(chainName: string): NonNullable<ChainStrategy['unavailable']> {
  return (context) =>
    context.identity.capabilities.otherChains
      ? null
      : {
          type: 'error',
          message:
            `This account keeps its keys on a hardware wallet, and ${chainName} there needs the ` +
            `device’s own ${chainName} app, which this app does not speak yet. Switch to an account ` +
            `with a recovery phrase to use ${chainName}.`,
        };
}
