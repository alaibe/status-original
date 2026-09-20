import { deleteAccountDatabase } from './database';
import type { Medium } from './inventory';
import { eraseMedia } from './media';
import { clearScope } from './scope';
import { accountScopedKeys, vaultDelete, vaultDeleteProtected, accountMnemonicKey } from './vault';

export interface EraseReport {
  erased: string[];
  failures: { medium: string; error: unknown }[];
}

export class AccountEraseError extends Error {
  constructor(readonly report: EraseReport) {
    super(`Could not erase: ${report.failures.map((failure) => failure.medium).join(', ')}`);
    this.name = 'AccountEraseError';
  }
}

type AccountEraser = (accountId: string) => Promise<void> | void;

const ACCOUNT_ERASE_DISPATCH: Record<Medium, AccountEraser> = {
  'async-storage': clearScope,
  files: eraseMedia,
  database: deleteAccountDatabase,
  vault: eraseAccountVault,
};

export async function eraseAccountStorage(accountId: string): Promise<EraseReport> {
  const report: EraseReport = { erased: [], failures: [] };

  const step = async (medium: string, run: () => Promise<void> | void) => {
    try {
      await run();
      report.erased.push(medium);
    } catch (error) {
      report.failures.push({ medium, error });
    }
  };

  for (const medium of ['async-storage', 'files', 'database'] as const) {
    await step(medium, () => ACCOUNT_ERASE_DISPATCH[medium](accountId));
  }

  if (report.failures.length === 0) {
    // Keep recovery material until every non-secret medium is gone and retryable.
    await step('vault', () => ACCOUNT_ERASE_DISPATCH.vault(accountId));
  }

  if (report.failures.length > 0) throw new AccountEraseError(report);
  return report;
}

async function eraseAccountVault(accountId: string): Promise<void> {
  const mnemonic = accountMnemonicKey(accountId);
  const failures: unknown[] = [];
  for (const key of accountScopedKeys(accountId).filter((key) => key !== mnemonic)) {
    try {
      await vaultDelete(key);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Could not erase account keys.');
  await vaultDelete(mnemonic);
  await vaultDeleteProtected(mnemonic);
}
