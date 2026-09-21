// In a browser WalletConnect swaps a wallet's url for the page origin and
// warns when they differ, so the window's origin is what dapps see either way.
export const METADATA_URL = window.location.origin;
