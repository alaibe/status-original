type RetentionAreas = {
  account: readonly string[];
  device: readonly string[];
};

export type Medium = 'async-storage' | 'vault' | 'files' | 'database';

export const STORAGE_INVENTORY = {
  'async-storage': {
    account: ['chat.', 'plugins.', 'plugin:', 'appearance'],
    device: [],
  },
  vault: {
    account: ['account.'],
    device: ['accounts.', 'security.'],
  },
  files: {
    account: ['attachments', 'gifs'],
    device: [],
  },
  database: {
    account: ['account-{account}.db'],
    device: [],
  },
} as const satisfies Record<Medium, RetentionAreas>;

export const OWNED_DIRECTORIES = STORAGE_INVENTORY.files.account;
