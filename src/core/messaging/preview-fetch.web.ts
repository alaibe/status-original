import { fetch } from '@tauri-apps/plugin-http';

// The window's own fetch is bound by CORS, which no site opens for link
// previews; the plugin's runs in Rust and carries the crawler user agent.
export const previewFetch: typeof fetch = fetch;
