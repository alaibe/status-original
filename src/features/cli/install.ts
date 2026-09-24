export interface CliInstall {
  installed: boolean;
  command: string | null;
}

/** The command line ships with the desktop app only (`install.web.ts`). */
export async function cliInstall(): Promise<CliInstall | null> {
  return null;
}
