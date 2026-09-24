import { errorMessage, NotConnectedError, UnsupportedError } from '@/core/errors';
import { LOCAL_PROTOCOL } from '@/core/messaging/namespace';

import { isCliAllowed } from './access';
import { findCommand, parseArgs } from './args';
import { nameWith, type CliEnv } from './context';
import { commandHelp, renderHelp } from './docs';
import { CliError } from './errors';
import { HANDLERS } from './handlers';
import { EXIT_CODES, type ExitCode } from './commands';

export async function runCli(argv: string[], env: CliEnv): Promise<ExitCode> {
  const { io } = env;
  io.json = argv.includes('--json');
  try {
    if (argv[0] === 'help') {
      const spec = findCommand(argv.slice(1));
      io.print(spec ? commandHelp(spec) : renderHelp());
      return EXIT_CODES.ok;
    }
    const parsed = parseArgs(argv);
    if (parsed.help) {
      io.print(commandHelp(parsed.spec));
      return EXIT_CODES.ok;
    }
    if (parsed.spec.path === 'quit') return EXIT_CODES.ok;
    if (!(await isCliAllowed())) {
      throw new CliError(
        'The command line is off. Turn it on in Status Original: Settings › Command line.',
        'unavailable'
      );
    }

    nameWith(env.host.registry);
    const output = await HANDLERS[parsed.spec.path](parsed, env);
    if (output) {
      if (io.json) io.print(JSON.stringify(output.data, null, io.tty ? 2 : undefined));
      else if (output.text !== undefined) io.print([output.text].flat().join('\n'));
      else io.print(JSON.stringify(output.data, null, 2));
    }
    return EXIT_CODES.ok;
  } catch (error) {
    const failure = asCliError(error);
    io.warn(
      io.json ? JSON.stringify({ error: failure.message, code: failure.code }) : failure.message
    );
    return failure.code;
  }
}

function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof NotConnectedError && error.protocol === LOCAL_PROTOCOL) {
    return new CliError('That chat lives on this device only and cannot do that.', 'unsupported');
  }
  if (error instanceof NotConnectedError) return new CliError(error.message, 'unavailable');
  if (error instanceof UnsupportedError) return new CliError(error.message, 'unsupported');
  return new CliError(errorMessage(error, 'Something went wrong.'));
}
