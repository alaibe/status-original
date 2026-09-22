import { defineConfig } from 'vitepress';

// Served from https://alaibe.github.io/status-original/ by .github/workflows/docs.yml.
// Everything here is the user guide. Developer documentation lives outside this
// folder, in README.md and CONTRIBUTING.md.
export default defineConfig({
  title: 'Status Original',
  description: 'How to use Status Original, the self-custodial messenger.',
  base: '/status-original/',
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/account' },
      { text: 'FAQ', link: '/faq' },
      { text: 'Privacy', link: '/privacy' },
      { text: 'Disclaimer', link: '/disclaimer' },
    ],
    sidebar: [
      {
        text: 'Using the app',
        items: [
          { text: 'Your account', link: '/guide/account' },
          { text: 'Chats', link: '/guide/chats' },
          { text: 'Messages', link: '/guide/messages' },
          { text: 'Networks', link: '/guide/networks' },
          { text: 'WhatsApp, Signal & friends', link: '/guide/bridges' },
          { text: 'Wallet', link: '/guide/wallet' },
          { text: 'Plugins & commands', link: '/guide/plugins' },
          { text: 'Settings', link: '/guide/settings' },
          { text: 'On the Mac', link: '/guide/mac' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'FAQ', link: '/faq' },
          { text: 'Privacy', link: '/privacy' },
          { text: 'Disclaimer', link: '/disclaimer' },
          { text: 'For developers', link: 'https://github.com/alaibe/status-original#readme' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/alaibe/status-original' }],
    editLink: {
      pattern: 'https://github.com/alaibe/status-original/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    footer: { message: 'Released under the MIT License.' },
  },
});
