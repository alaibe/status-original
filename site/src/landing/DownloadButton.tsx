'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';

import type { Download, Platform, Release } from '@/lib/release';

const names: Record<Platform, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  android: 'Android',
  ios: 'iPhone',
};

function detectPlatform(): Platform | null {
  let ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac/.test(ua)) return 'mac';
  if (/Win/.test(ua)) return 'windows';
  if (/Linux|X11/.test(ua)) return 'linux';
  return null;
}

export function usePlatform() {
  let [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);
  return platform;
}

export function DownloadIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function primaryDownload(release: Release, platform: Platform | null): Download | null {
  if (!platform) return null;
  return release.downloads.find((download) => download.platform === platform) ?? null;
}

export function DownloadButton({
  release,
  color = 'brand',
  className,
}: {
  release: Release;
  color?: 'brand' | 'white';
  className?: string;
}) {
  let platform = usePlatform();
  let download = primaryDownload(release, platform);

  let label = download
    ? `Download for ${names[download.platform]}`
    : platform === 'ios'
      ? 'Coming to the App Store'
      : release.version
        ? 'Choose a download'
        : 'Get it on GitHub';

  let href = download?.url ?? (platform === 'ios' || release.version ? '#download' : release.url);

  return (
    <a
      href={href}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
        color === 'brand'
          ? 'bg-brand-600 text-white shadow-sm shadow-brand-900/20 hover:bg-brand-500 active:bg-brand-700'
          : 'bg-white text-brand-900 hover:bg-white/90 active:text-brand-900/70',
        className
      )}>
      <DownloadIcon className="h-5 w-5 flex-none" />
      {label}
    </a>
  );
}
