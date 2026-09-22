export const repo = 'alaibe/status-original';
export const repoUrl = `https://github.com/${repo}`;
export const releasesUrl = `${repoUrl}/releases`;
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface NavGroup {
  title: string;
  links: Array<{ title: string; href: string; description?: string }>;
}

export const navigation: Array<NavGroup> = [
  {
    title: 'Using the app',
    links: [
      { title: 'Introduction', href: '/guide' },
      { title: 'Your account', href: '/guide/account' },
      { title: 'Chats', href: '/guide/chats' },
      { title: 'Messages', href: '/guide/messages' },
      { title: 'Networks', href: '/guide/networks' },
      { title: 'WhatsApp, Signal & friends', href: '/guide/bridges' },
      { title: 'Your own homeserver', href: '/guide/homeserver' },
      { title: 'Wallet', href: '/guide/wallet' },
      { title: 'Plugins & commands', href: '/guide/plugins' },
      { title: 'Settings', href: '/guide/settings' },
      { title: 'On the Mac', href: '/guide/mac' },
    ],
  },
  {
    title: 'Reference',
    links: [
      { title: 'FAQ', href: '/faq' },
      { title: 'Privacy', href: '/privacy' },
      { title: 'Disclaimer', href: '/disclaimer' },
    ],
  },
];

export function withoutTrailingSlash(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}
