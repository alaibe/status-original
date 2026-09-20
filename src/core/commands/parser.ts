
export interface ParsedCommand {
  name: string;
  rest: string;
  args: string[];
}

const COMMAND_RE = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/;

export function parseCommand(input: string): ParsedCommand | null {
  const match = COMMAND_RE.exec(input.trim());
  if (!match) return null;

  const rest = match[2] ?? '';
  return {
    name: match[1].toLowerCase(),
    rest,
    args: tokenize(rest),
  };
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

export function isTypingCommandName(input: string): boolean {
  return /^\/[a-zA-Z][\w-]*$/.test(input) || input === '/';
}

export function commandNamePrefix(input: string): string {
  if (!input.startsWith('/')) return '';
  return input.slice(1).split(/\s/)[0].toLowerCase();
}

export function completeCommandName(input: string, names: string[]): string | null {
  if (!isTypingCommandName(input)) return null;

  const prefix = commandNamePrefix(input);
  const candidates = names.filter((name) => name.toLowerCase().startsWith(prefix));
  if (candidates.length === 0) return null;

  let shared = candidates[0];
  for (const name of candidates.slice(1)) {
    let i = 0;
    while (i < shared.length && i < name.length && shared[i] === name[i]) i += 1;
    shared = shared.slice(0, i);
  }

  const completed = candidates.length === 1 ? `/${shared} ` : `/${shared}`;
  return completed === input ? null : completed;
}
