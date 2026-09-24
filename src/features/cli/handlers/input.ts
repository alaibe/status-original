import { errorMessage } from '@/core/errors';

import type { CliIo } from '../context';
import { CliError } from '../errors';

/** What was piped in; nothing at a terminal, where reading would wait for Ctrl-D. */
export async function stdinText(io: CliIo): Promise<string | undefined> {
  return io.stdinTty ? undefined : new TextDecoder().decode(await io.stdin());
}

/** Piped input when there is some, a prompt at a terminal otherwise. */
export async function readText(io: CliIo, prompt: string, secret = false): Promise<string> {
  return (await stdinText(io))?.trim() ?? io.prompt(prompt, secret);
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export async function readFileArg(io: CliIo, path: string): Promise<Uint8Array> {
  if (path === '-') return io.stdin();
  try {
    return await io.readFile(path);
  } catch (error) {
    throw new CliError(
      `Could not read ${path}: ${errorMessage(error)}. If this copy of the app is sandboxed, pipe the file instead: --file - < ${path}`
    );
  }
}
