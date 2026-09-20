import { describeChange } from './bot';

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

/** The fallback line is what a notification and the chat list show, so that is what to assert on. */
const summarise = (content: ReturnType<typeof describeChange>) =>
  content?.kind === 'widget' ? content.fallback : null;

const stats = (confirmed: bigint, pending: bigint) => ({ confirmed, pending });

describe('what the Bitcoin bot says', () => {
  it('stays quiet when nothing moved', () => {
    expect(describeChange(stats(50_000n, 0n), stats(50_000n, 0n), ADDRESS)).toBeNull();
  });

  it('announces a payment while it is still in the mempool', () => {
    // The gap between "they sent it" and "it confirmed" is the moment a
    // command cannot serve, because you do not know to ask.
    const summary = summarise(describeChange(stats(0n, 0n), stats(0n, 25_000n), ADDRESS));

    expect(summary).toContain('In the mempool');
    expect(summary).toContain('+0.00025 BTC');
  });

  it('announces the same payment again once it confirms', () => {
    const summary = summarise(describeChange(stats(0n, 25_000n), stats(25_000n, 0n), ADDRESS));

    expect(summary).toContain('Confirmed');
    expect(summary).toContain('+0.00025 BTC');
  });

  it('distinguishes coins leaving from coins arriving', () => {
    expect(summarise(describeChange(stats(50_000n, 0n), stats(20_000n, 0n), ADDRESS))).toContain(
      'Spent'
    );
    expect(summarise(describeChange(stats(0n, 0n), stats(0n, -30_000n), ADDRESS))).toContain(
      'Leaving your address'
    );
  });

  it('does not repeat the mempool line once the balance is confirmed', () => {
    // A confirmed change wins: saying "still pending" after "confirmed" would
    // read as a second, imaginary payment.
    const summary = summarise(describeChange(stats(0n, 25_000n), stats(25_000n, 5_000n), ADDRESS));

    expect(summary).toContain('Confirmed');
    expect(summary).not.toContain('In the mempool');
  });

  it('says nothing when the mempool merely clears', () => {
    // Pending going to zero with the confirmed balance untouched means the
    // transaction was replaced or dropped. Nothing arrived, so there is
    // nothing to say.
    expect(describeChange(stats(10_000n, 5_000n), stats(10_000n, 0n), ADDRESS)).toBeNull();
  });
});
