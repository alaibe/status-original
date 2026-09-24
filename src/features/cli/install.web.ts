import { invoke } from '@tauri-apps/api/core';

import type { CliInstall } from './install';

export function cliInstall(): Promise<CliInstall | null> {
  return invoke<CliInstall>('cli_install');
}
