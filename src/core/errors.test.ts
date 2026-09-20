import { errorMessage } from './errors';

/**
 * What a thrown error looks like by the time a person reads it.
 *
 * The motivating case was on screen: viem's failed balance lookup arrived in
 * the middle of a conversation as eight lines of red (the URL, the JSON-RPC
 * body, the underlying fetch exception, the library version), none of which
 * anyone can act on.
 */
describe('errorMessage', () => {
  it('replaces a viem network dump with something you can act on', () => {
    const viem = new Error(
      [
        'HTTP request failed.',
        '',
        'URL: https://ethereum.reth.rs/rpc',
        'Request body: [{"method":"eth_getBalance","params":["0x4a35","latest"]}]',
        '',
        'Details: fetch failed: FetchRequestCanceledException: Fetch request has been canceled',
        'Version: viem@2.56.3',
      ].join('\n')
    );

    const message = errorMessage(viem);

    expect(message).toBe(
      'Could not reach the network. Check your connection, or point this chain at your own endpoint with /rpc.'
    );
    // The diagnostics belong in a bug report, not in the conversation.
    expect(message).not.toContain('viem');
    expect(message).not.toContain('eth_getBalance');
    expect(message.split('\n')).toHaveLength(1);
  });

  it('keeps a message that was already written for a person', () => {
    expect(errorMessage(new Error('"0xnope" is not an address.'))).toBe(
      '"0xnope" is not an address.'
    );
  });

  it('drops everything after the first line', () => {
    expect(errorMessage(new Error('Something broke.\n\nat someFunction (file.ts:1)'))).toBe(
      'Something broke.'
    );
  });

  it('truncates a single line nobody would read to the end of', () => {
    const long = 'x'.repeat(500);
    expect(errorMessage(new Error(long))).toHaveLength(201);
  });

  it('falls back when there is nothing to show', () => {
    expect(errorMessage(undefined, 'Could not send')).toBe('Could not send');
    expect(errorMessage(new Error(''), 'Could not send')).toBe('Could not send');
  });
});
