import { create } from 'zustand';

import type { ChatFilter, Directory } from '@/core/messaging/folders';

interface FolderState {
  /** The folder the list has slid into, or null for the inbox. */
  directory: Directory | null;
  setDirectory(directory: Directory | null): void;
  filter: ChatFilter;
  setFilter(filter: ChatFilter): void;
}

/** Outlives the list, so leaving a chat and coming back finds the same folder. */
export const useFolderStore = create<FolderState>((set) => ({
  directory: null,
  setDirectory: (directory) => set({ directory }),
  filter: 'all',
  setFilter: (filter) => set({ filter }),
}));
