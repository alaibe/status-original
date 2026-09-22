import type { Metadata } from 'next';

import { basePath } from '@/lib/site';

export const siteMetadata: Metadata = {
  metadataBase: new URL('https://alaibe.github.io'),
  icons: { icon: `${basePath}/logomark.svg` },
  openGraph: {
    siteName: 'Status Original',
    images: [`${basePath}/screenshots/chats.png`],
  },
};
