import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { Providers } from '@/app/(docs)/providers';
import { Layout } from '@/docs/Layout';
import { allPages } from '@/lib/docs';
import { siteMetadata } from '@/lib/metadata';

import '@/styles/docs.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  ...siteMetadata,
  title: { template: '%s · Status Original guide', default: 'Status Original guide' },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  let allSections = {
    '/guide': [{ id: 'guides', title: 'The guide' }],
    ...Object.fromEntries(allPages().map((page) => [page.href, page.sections])),
  };

  return (
    <html lang="en" className={`h-full ${inter.variable}`} suppressHydrationWarning>
      <body className="flex min-h-full bg-white antialiased dark:bg-zinc-900">
        <Providers>
          <div className="w-full">
            <Layout allSections={allSections}>{children}</Layout>
          </div>
        </Providers>
      </body>
    </html>
  );
}
