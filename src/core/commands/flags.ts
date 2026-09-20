function flagIndex(args: string[], flag: string, aliases: string[]): number {
  return args.findIndex((a) => a === flag || aliases.includes(a));
}

export function flagValue(
  args: string[],
  flag: string,
  aliases: string[] = []
): string | undefined {
  const at = flagIndex(args, flag, aliases);
  return at === -1 ? undefined : args[at + 1];
}

export function withoutFlag(args: string[], flag: string, aliases: string[] = []): string[] {
  const at = flagIndex(args, flag, aliases);
  return at === -1 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
}
