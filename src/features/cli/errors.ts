import { EXIT_CODES, type ExitCode } from './commands';

export class CliError extends Error {
  readonly code: ExitCode;

  constructor(message: string, kind: keyof typeof EXIT_CODES = 'failed') {
    super(message);
    this.code = EXIT_CODES[kind];
  }
}
