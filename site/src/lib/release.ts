import { releasesUrl, repo } from '@/lib/site';

export type Platform = 'mac' | 'windows' | 'linux' | 'android' | 'ios';

export interface Download {
  platform: Platform;
  label: string;
  detail: string;
  url: string;
  size?: number;
}

export interface Release {
  version: string | null;
  url: string;
  downloads: Array<Download>;
}

const kinds: Array<[RegExp, Platform, string, string]> = [
  [/\.dmg$/, 'mac', 'macOS', 'Apple silicon and Intel · .dmg'],
  [/-setup\.exe$/, 'windows', 'Windows', 'Installer · .exe'],
  [/\.msi$/, 'windows', 'Windows', 'MSI package · .msi'],
  [/\.AppImage$/, 'linux', 'Linux', 'AppImage'],
  [/\.deb$/, 'linux', 'Linux', 'Debian and Ubuntu · .deb'],
  [/\.rpm$/, 'linux', 'Linux', 'Fedora and openSUSE · .rpm'],
  [/\.apk$/, 'android', 'Android', 'APK'],
];

export async function getRelease(): Promise<Release> {
  let headers: HeadersInit = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers,
  }).catch(() => null);

  if (!response?.ok) {
    return { version: null, url: releasesUrl, downloads: [] };
  }

  let release = (await response.json()) as {
    tag_name: string;
    html_url: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  };

  let downloads = kinds.flatMap(([pattern, platform, label, detail]) =>
    release.assets
      .filter((asset) => pattern.test(asset.name))
      .map((asset) => ({
        platform,
        label,
        detail,
        url: asset.browser_download_url,
        size: asset.size,
      }))
  );

  return { version: release.tag_name.replace(/^v/, ''), url: release.html_url, downloads };
}
