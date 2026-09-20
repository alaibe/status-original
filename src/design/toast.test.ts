import { toast, useToastStore } from './toast';

beforeEach(() => useToastStore.setState({ toasts: [] }));

describe('toasts', () => {
  it('dismisses one without touching the others', () => {
    toast.info('first');
    toast.error('second');
    const [first] = useToastStore.getState().toasts;

    useToastStore.getState().dismiss(first.id);

    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['second']);
  });

  it('ignores a dismiss for one that already expired', () => {
    // A swipe and the auto-expiry both remove by id, and either can win. The
    // loser must be a no-op.
    toast.info('gone');
    const [only] = useToastStore.getState().toasts;

    useToastStore.getState().dismiss(only.id);
    expect(() => useToastStore.getState().dismiss(only.id)).not.toThrow();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
