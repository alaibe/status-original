import type * as ViemEns from 'viem/ens';

/** `viem/ens` evaluates all of `ox`, BLS12-381 included, so it loads at its first use. */
export const viemEns = (): typeof ViemEns =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('viem/ens');
