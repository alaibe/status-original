import { create } from 'zustand';

import { ConfirmSheet } from '@/design';

interface Pending {
  id: number;
  request: string;
  resolve(approved: boolean): void;
}

const useApprovals = create<{ queue: Pending[] }>(() => ({ queue: [] }));

let nextId = 0;

function settle(id: number, approved: boolean): void {
  const item = useApprovals.getState().queue.find((p) => p.id === id);
  if (!item) return;
  useApprovals.setState((s) => ({ queue: s.queue.filter((p) => p.id !== id) }));
  item.resolve(approved);
}

/** Resolves false when declined, or when the terminal that asked goes away first. */
export function requestApproval(request: string, abandoned: Promise<void>): Promise<boolean> {
  const id = ++nextId;
  return new Promise((resolve) => {
    useApprovals.setState((s) => ({ queue: [...s.queue, { id, request, resolve }] }));
    void abandoned.then(() => settle(id, false));
  });
}

export function CliApprovals() {
  const current = useApprovals((s) => s.queue[0]);
  return (
    <ConfirmSheet
      visible={Boolean(current)}
      onClose={() => current && settle(current.id, false)}
      title="The command line is asking"
      body={[
        ...(current?.request.split('\n') ?? []),
        'Approve only what you, or an assistant you are running, just asked for.',
      ]}
      confirm={{
        label: 'Approve',
        testID: 'cli-approve',
        onPress: () => current && settle(current.id, true),
      }}
      cancelLabel="Decline"
    />
  );
}
