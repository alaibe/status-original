'use client';

import clsx from 'clsx';

import { CircleBackground } from '@/landing/CircleBackground';
import { Container } from '@/landing/Container';
import { DownloadButton, DownloadIcon, usePlatform } from '@/landing/DownloadButton';
import type { Platform, Release } from '@/lib/release';
import { repoUrl } from '@/lib/site';

const platforms: Array<{ platform: Platform; name: string; empty: string }> = [
  { platform: 'mac', name: 'macOS', empty: 'Not in this release.' },
  { platform: 'windows', name: 'Windows', empty: 'Not in this release.' },
  { platform: 'linux', name: 'Linux', empty: 'Not in this release.' },
  { platform: 'android', name: 'Android', empty: 'Not released yet.' },
  {
    platform: 'ios',
    name: 'iPhone',
    empty: 'Apple allows no downloads outside the App Store. It is on its way there.',
  },
];

function formatSize(bytes?: number) {
  return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : null;
}

export function Download({ release }: { release: Release }) {
  let current = usePlatform();

  return (
    <section
      id="download"
      aria-labelledby="download-title"
      className="relative scroll-mt-8 overflow-hidden bg-gray-900 py-20 sm:py-28">
      <div className="absolute top-1/2 left-20 -translate-y-1/2 sm:left-1/2 sm:-translate-x-1/2">
        <CircleBackground color="#fff" className="animate-spin-slower" />
      </div>
      <Container className="relative">
        <div className="mx-auto max-w-xl sm:text-center">
          <h2
            id="download-title"
            className="text-3xl font-medium tracking-tight text-white sm:text-4xl">
            Get Status Original
          </h2>
          <p className="mt-4 text-lg text-gray-300">
            {release.version
              ? `Version ${release.version}, free and open source. Every build comes from the same code on GitHub.`
              : 'The first release is on its way. Until then the app builds from source on GitHub.'}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <DownloadButton release={release} color="white" />
            <a
              href={release.version ? release.url : `${repoUrl}#readme`}
              className="inline-flex items-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/10">
              {release.version ? 'Release notes' : 'Build from source'}
            </a>
          </div>
        </div>
        <ul
          role="list"
          className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-none lg:grid-cols-5">
          {platforms.map(({ platform, name, empty }) => {
            let files = release.downloads.filter((download) => download.platform === platform);
            return (
              <li
                key={platform}
                className={clsx(
                  'rounded-2xl p-6 ring-1 transition-colors',
                  platform === current
                    ? 'bg-brand-500/15 ring-brand-300/50'
                    : 'bg-white/5 ring-white/10'
                )}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">{name}</h3>
                  {platform === current && (
                    <span className="rounded-full bg-brand-300/20 px-2 py-0.5 text-xs text-brand-100">
                      This device
                    </span>
                  )}
                </div>
                {files.length > 0 ? (
                  <ul role="list" className="mt-4 space-y-3">
                    {files.map((file) => (
                      <li key={file.url}>
                        <a
                          href={file.url}
                          className="group flex items-start gap-2 text-sm text-gray-300 hover:text-white">
                          <DownloadIcon className="mt-0.5 h-4 w-4 flex-none text-brand-300 group-hover:text-white" />
                          <span>
                            {file.detail}
                            {formatSize(file.size) && (
                              <span className="block text-xs text-gray-500">
                                {formatSize(file.size)}
                              </span>
                            )}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-gray-400">
                    {release.version || platform === 'ios'
                      ? empty
                      : 'Coming with the first release.'}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
