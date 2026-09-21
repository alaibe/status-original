import type { PluginContext } from '@/core/plugins/types';
import { lookupName, resolveName } from '@/lib/evm/ens';

import { addressCard } from './address-card';
import { registerChainStrategy, type ChainStrategy } from './chains/strategy';

jest.mock('@/lib/evm/ens', () => ({
  looksLikeEnsName: (value: string) => /\.[a-z]{2,}$/i.test(value),
  lookupName: jest.fn(),
  resolveName: jest.fn(),
}));
jest.mock('./bitcoin/bot', () => ({ checkAddress: jest.fn() }));
jest.mock('./bitcoin', () => ({ bitcoinStrategy: jest.fn() }));
jest.mock('./bitcoin/config', () => ({ hydrateApiBase: jest.fn() }));
jest.mock('./solana', () => ({ solanaStrategy: {} }));
jest.mock('./chains/watcher', () => ({ checkBalances: jest.fn() }));

const vitalik = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const context = { storage: { get: async () => null } } as unknown as PluginContext;

const ethereum: ChainStrategy = {
  id: 'ethereum',
  name: 'Ethereum',
  icon: 'diamond-outline',
  selfAddress: () => '0x0',
  isAddress: (value) => /^0x[0-9a-fA-F]{40}$/.test(value),
  addressHint: '0x…',
  balance: async () => '1.5',
  explorer: { name: 'Etherscan', addressUrl: (a) => `https://etherscan.io/address/${a}` },
  transfer: { symbol: 'ETH', quote: async () => ({ error: 'no' }), commit: async () => '' },
  endpoint: {
    current: async () => '',
    isDefault: () => true,
    set: async () => {},
    check: async () => ({ ok: true }),
    noun: 'endpoint',
  },
};

let dispose: () => void;

beforeEach(() => {
  dispose = registerChainStrategy(ethereum);
  jest.mocked(lookupName).mockReset();
  jest.mocked(resolveName).mockReset();
});

afterEach(() => dispose());

describe('addressCard', () => {
  it('names an address, shows its balance and offers to send', async () => {
    jest.mocked(lookupName).mockResolvedValue('vitalik.eth');
    const card = await addressCard(context, vitalik);

    expect(card.fallback).toBe('vitalik.eth on Ethereum');
    expect(card.widget).toEqual({
      kind: 'card',
      children: [
        {
          kind: 'list',
          items: [
            {
              title: 'vitalik.eth',
              subtitle: '0xd8dA…6045 · 1.5 ETH · Ethereum',
              icon: 'diamond-outline',
              actions: [
                {
                  label: 'Send ETH',
                  command: `/send vitalik.eth --chain ethereum`,
                  icon: 'arrow-up-circle-outline',
                },
              ],
            },
          ],
        },
        {
          kind: 'link',
          label: 'View on Etherscan',
          url: `https://etherscan.io/address/${vitalik}`,
          icon: 'open-outline',
        },
      ],
    });
  });

  it('resolves an ENS name first and survives a failed balance read', async () => {
    jest.mocked(resolveName).mockResolvedValue(vitalik);
    dispose();
    dispose = registerChainStrategy({ ...ethereum, balance: async () => { throw new Error('rpc'); } });

    const card = await addressCard(context, 'Vitalik.eth');
    const item = card.widget.kind === 'card' && card.widget.children[0].kind === 'list'
      ? card.widget.children[0].items[0]
      : undefined;
    expect(item?.title).toBe('vitalik.eth');
    expect(item?.subtitle).toBe('0xd8dA…6045 · Ethereum');
    expect(lookupName).not.toHaveBeenCalled();
  });

  it('leaves out the send action where /send cannot run', async () => {
    jest.mocked(lookupName).mockResolvedValue(null);
    const card = await addressCard(context, vitalik, { offerSend: false });
    const item = card.widget.kind === 'card' && card.widget.children[0].kind === 'list'
      ? card.widget.children[0].items[0]
      : undefined;
    expect(item?.title).toBe('0xd8dA…6045');
    expect(item?.actions).toEqual([]);
  });

  it('rejects names that resolve to nothing and addresses of networks that are off', async () => {
    jest.mocked(resolveName).mockResolvedValue(null);
    await expect(addressCard(context, 'nobody.eth')).rejects.toThrow('No address is set');
    await expect(addressCard(context, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).rejects.toThrow(
      'network that is off'
    );
  });
});
