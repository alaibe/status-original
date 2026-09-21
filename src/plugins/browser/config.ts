import Constants from 'expo-constants';

import type { IconName } from '@/design';

import { METADATA_URL } from './metadata-url';

export function walletConnectProjectId(): string | null {
  const fromExtra = Constants.expoConfig?.extra?.walletConnectProjectId;
  const fromEnv = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const value = (typeof fromExtra === 'string' ? fromExtra : null) ?? fromEnv ?? null;
  return value && value.length > 0 ? value : null;
}

export const APP_METADATA: {
  name: string;
  description: string;
  url: string;
  icons: string[];
  redirect: { native: string };
} = {
  name: 'Status Original',
  description: 'Encrypted chat with an Ethereum wallet built in.',
  url: METADATA_URL,
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
  redirect: {
    native: 'statusoriginal://',
  },
};

export interface Bookmark {
  id: string;
  name: string;
  url: string;
  description: string;
  icon: IconName;
  custom?: boolean;
}

export const SUGGESTED_BOOKMARKS: Bookmark[] = [
  {
    id: 'uniswap',
    name: 'Uniswap',
    url: 'https://app.uniswap.org',
    description: 'Swap tokens through Uniswap liquidity pools.',
    icon: 'swap-horizontal-outline',
  },
  {
    id: 'cowswap',
    name: 'CoW Swap',
    url: 'https://swap.cow.fi',
    description: 'Swap through batch auctions, MEV-protected.',
    icon: 'shield-checkmark-outline',
  },
  {
    id: '1inch',
    name: '1inch',
    url: 'https://app.1inch.io',
    description: 'Compare swap routes across multiple exchanges.',
    icon: 'git-merge-outline',
  },
  {
    id: 'matcha',
    name: 'Matcha',
    url: 'https://matcha.xyz',
    description: 'Compare liquidity across exchanges, powered by 0x.',
    icon: 'git-merge-outline',
  },
  {
    id: 'sushiswap',
    name: 'SushiSwap',
    url: 'https://www.sushi.com/swap',
    description: 'Swap with aggregated liquidity across supported EVM networks.',
    icon: 'swap-horizontal-outline',
  },
  {
    id: 'curve',
    name: 'Curve',
    url: 'https://www.curve.finance',
    description: 'Swap stablecoins and other tokens through Curve pools.',
    icon: 'swap-horizontal-outline',
  },
  {
    id: 'aave',
    name: 'Aave',
    url: 'https://app.aave.com',
    description: 'Lend and borrow against what you hold.',
    icon: 'trending-up-outline',
  },
  {
    id: 'opensea',
    name: 'OpenSea',
    url: 'https://opensea.io',
    description: 'Buy and sell NFTs.',
    icon: 'images-outline',
  },
  {
    id: 'etherscan',
    name: 'Etherscan',
    url: 'https://etherscan.io',
    description: 'Look up any transaction, address or contract.',
    icon: 'search-outline',
  },
  {
    id: 'mirror',
    name: 'Mirror',
    url: 'https://mirror.xyz',
    description: 'Publishing. Write posts, mint them, crowdfund them.',
    icon: 'book-outline',
  },
];
