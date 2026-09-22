import Link from 'next/link';

import { Container } from '@/landing/Container';
import { GitHubIcon } from '@/landing/Header';
import { Logomark } from '@/landing/Logo';
import { NavLinks } from '@/landing/NavLinks';
import { repoUrl } from '@/lib/site';

const legal = [
  ['Privacy', '/privacy'],
  ['Disclaimer', '/disclaimer'],
  ['Security', `${repoUrl}/blob/main/SECURITY.md`],
  ['License', `${repoUrl}/blob/main/LICENSE`],
];

export function Footer() {
  return (
    <footer className="border-t border-gray-200">
      <Container>
        <div className="flex flex-col items-start justify-between gap-y-12 pt-16 pb-6 lg:flex-row lg:items-center lg:py-16">
          <div>
            <div className="flex items-center text-gray-900">
              <Logomark className="h-10 w-10 flex-none" />
              <div className="ml-4">
                <p className="text-base font-semibold">Status Original</p>
                <p className="mt-1 text-sm">A messenger with no company in the middle.</p>
              </div>
            </div>
            <nav className="mt-11 flex flex-wrap gap-8">
              <NavLinks />
            </nav>
          </div>
          <a
            href={repoUrl}
            className="group relative -mx-4 flex items-center self-stretch p-4 transition-colors hover:bg-gray-100 sm:self-auto sm:rounded-2xl lg:mx-0 lg:self-auto lg:p-6">
            <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl bg-gray-900 transition-colors group-hover:bg-brand-600">
              <GitHubIcon className="h-8 w-8 fill-white" />
            </div>
            <div className="ml-6 lg:w-64">
              <p className="text-base font-semibold text-gray-900">Open source, MIT licensed</p>
              <p className="mt-1 text-sm text-gray-700">
                Read the code, file an issue or build it yourself on GitHub.
              </p>
            </div>
          </a>
        </div>
        <div className="flex flex-col items-center gap-6 border-t border-gray-200 pt-8 pb-12 md:flex-row-reverse md:justify-between md:pt-6">
          <nav className="flex gap-6 text-sm text-gray-500">
            {legal.map(([label, href]) => (
              <Link key={label} href={href} className="hover:text-gray-900">
                {label}
              </Link>
            ))}
          </nav>
          <p className="text-sm text-gray-500">
            &copy; {new Date().getFullYear()} Status Original contributors.
          </p>
        </div>
      </Container>
    </footer>
  );
}
