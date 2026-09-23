import { create } from 'zustand';

import type { ChatFilter, Directory } from '@/core/messaging/folders';

interface FolderState {
  directory: Directory | null;
  setDirectory(directory: Directory | null): void;
  filter: ChatFilter;
  setFilter(filter: ChatFilter): void;
}

export const useFolderStore = create<FolderState>((set) => ({
  directory: null,
  setDirectory: (directory) => set({ directory }),
  filter: 'all',
  setFilter: (filter) => set({ filter }),
}));
