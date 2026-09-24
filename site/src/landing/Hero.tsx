import { useId } from 'react';

import { Button } from '@/landing/Button';
import { Container } from '@/landing/Container';
import { DownloadButton } from '@/landing/DownloadButton';
import { AppDemo } from '@/landing/AppDemo';
import { PhoneFrame } from '@/landing/PhoneFrame';
import type { Release } from '@/lib/release';

function BackgroundIllustration(props: React.ComponentPropsWithoutRef<'div'>) {
  let id = useId();

  return (
    <div {...props}>
      <svg
        viewBox="0 0 1026 1026"
        fill="none"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full animate-spin-slow">
        <path
          d="M1025 513c0 282.77-229.23 512-512 512S1 795.77 1 513 230.23 1 513 1s512 229.23 512 512Z"
          stroke="#D4D4D4"
          strokeOpacity="0.7"
        />
        <path
          d="M513 1025C230.23 1025 1 795.77 1 513"
          stroke={`url(#${id}-gradient-1)`}
          strokeLinecap="round"
        />
        <defs>
          <linearGradient
            id={`${id}-gradient-1`}
            x1="1"
            y1="513"
            x2="1"
            y2="1025"
            gradientUnits="userSpaceOnUse">
            <stop stopColor="#4A57AD" />
            <stop offset="1" stopColor="#4A57AD" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <svg
        viewBox="0 0 1026 1026"
        fill="none"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full animate-spin-reverse-slower">
        <path
          d="M913 513c0 220.914-179.086 400-400 400S113 733.914 113 513s179.086-400 400-400 400 179.086 400 400Z"
          stroke="#D4D4D4"
          strokeOpacity="0.7"
        />
        <path
          d="M913 513c0 220.914-179.086 400-400 400"
          stroke={`url(#${id}-gradient-2)`}
          strokeLinecap="round"
        />
        <defs>
          <linearGradient
            id={`${id}-gradient-2`}
            x1="913"
            y1="513"
            x2="913"
            y2="913"
            gradientUnits="userSpaceOnUse">
            <stop stopColor="#4A57AD" />
            <stop offset="1" stopColor="#4A57AD" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

function BookIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 5.5C8.5 4.3 6.5 4 3.5 4v11c3 0 5 .3 6.5 1.5m0-11c1.5-1.2 3.5-1.5 6.5-1.5v11c-3 0-5 .3-6.5 1.5m0-11v11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TerminalIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3.5 4h13v12h-13V4Zm3 4 2 2-2 2m4 0h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const networks = ['XMTP', 'Nostr', 'Waku', 'Telegram', 'Matrix'];

export function Hero({ release }: { release: Release }) {
  return (
    <div className="overflow-hidden py-20 sm:py-32 lg:pb-32 xl:pb-36">
      <Container>
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-8 lg:gap-y-20">
          <div className="relative z-10 mx-auto max-w-2xl lg:col-span-7 lg:max-w-none lg:pt-6 xl:col-span-6">
            {release.version && (
              <a
                href={release.url}
                className="mb-8 inline-flex items-center gap-x-2 rounded-full bg-brand-50 px-3 py-1 text-sm/6 font-medium text-brand-700 ring-1 ring-brand-600/15 ring-inset hover:bg-brand-100">
                Version {release.version} is out
                <span aria-hidden="true">→</span>
              </a>
            )}
            <h1 className="text-4xl font-medium tracking-tight text-gray-900 sm:text-5xl">
              A messenger with no company in the middle, ready for your AI.
            </h1>
            <p className="mt-6 text-lg text-gray-600">
              Your account is twelve words on your device. No sign-up, no phone number, no email,
              and no account on a server that could be seized, sold or breached. On a computer,
              Claude Code or Codex can read and answer your chats through the command line, and you
              still approve anything that signs.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-4">
              <DownloadButton release={release} />
              <Button href="/guide" variant="outline" className="items-center">
                <BookIcon className="h-5 w-5 flex-none text-gray-500" />
                <span className="ml-2.5">Read the guide</span>
              </Button>
              <Button href="/guide/command-line" variant="outline" className="items-center">
                <TerminalIcon className="h-5 w-5 flex-none text-gray-500" />
                <span className="ml-2.5">Use it with AI</span>
              </Button>
            </div>
          </div>
          <div className="relative mt-10 sm:mt-20 lg:col-span-5 lg:row-span-2 lg:mt-0 xl:col-span-6">
            <BackgroundIllustration className="absolute top-4 left-1/2 h-[1026px] w-[1026px] -translate-x-1/3 mask-[linear-gradient(to_bottom,white_20%,transparent_75%)] stroke-gray-300/70 sm:top-16 sm:-translate-x-1/2 lg:-top-16 lg:ml-12 xl:-top-14 xl:ml-0" />
            <div className="-mx-4 h-[448px] mask-[linear-gradient(to_bottom,white_75%,transparent)] px-9 sm:mx-0 lg:absolute lg:-inset-x-10 lg:-top-10 lg:-bottom-20 lg:h-auto lg:px-0 lg:pt-10 xl:-bottom-32">
              <PhoneFrame className="mx-auto max-w-[366px]" priority>
                <AppDemo />
              </PhoneFrame>
            </div>
          </div>
          <div className="relative -mt-4 lg:col-span-7 lg:mt-0 xl:col-span-6">
            <p className="text-center text-sm font-semibold text-gray-900 lg:text-left">
              Talks over
            </p>
            <ul
              role="list"
              className="mx-auto mt-6 flex max-w-xl flex-wrap justify-center gap-x-3 gap-y-3 lg:mx-0 lg:justify-start">
              {networks.map((name) => (
                <li
                  key={name}
                  className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold tracking-tight text-gray-500 shadow-sm ring-1 shadow-gray-900/5 ring-gray-900/10">
                  {name}
                </li>
              ))}
              <li className="rounded-full px-2 py-1.5 text-sm text-gray-500">
                and WhatsApp or Signal through a Matrix bridge
              </li>
            </ul>
          </div>
        </div>
      </Container>
    </div>
  );
}
