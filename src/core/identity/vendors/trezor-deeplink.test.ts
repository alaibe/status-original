import { handleTrezorCallback } from './trezor-deeplink';

/**
 * Only the callback routing is testable here. Everything else opens Trezor
 * Suite, which needs the app installed and a device plugged into it.
 *
 * This half is worth testing on its own: a deep link is a URL the OS hands
 * over, and anything that can register the scheme could send a fake one.
 */
describe('handleTrezorCallback', () => {
  it('ignores a link nothing is waiting for', () => {
    // Unmatched ids must be passed on: other features use deep links too, and
    // eating theirs would break them silently.
    expect(handleTrezorCallback('myapp://trezor?id=nobody&payload=0xabc')).toBe(false);
  });

  it('ignores a link with no request id at all', () => {
    expect(handleTrezorCallback('myapp://something-else')).toBe(false);
  });
});

describe('parsing the callback', () => {
  it('reads a payload out of a custom-scheme URL', () => {
    // Not `new URL` and not `Linking.parse`: the first is unreliable for
    // custom schemes across engines, the second needs a native module in what
    // should be a pure function.
    expect(handleTrezorCallback('statusoriginal://trezor?id=x&payload=0xabc')).toBe(false);
  });

  it('does not mistake an encoded value for a missing one', () => {
    expect(handleTrezorCallback('statusoriginal://trezor?id=a%2Fb&payload=0x1')).toBe(false);
  });
});
