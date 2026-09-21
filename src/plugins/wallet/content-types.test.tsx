import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { Button } from '@/design';
import type { MessageRendererProps, PluginContext } from '@/core/plugins/types';

import { registerChainStrategy, type ChainStrategy } from './chains/strategy';
import { walletContentTypes } from './content-types';
import { CONTENT_TYPE_PAYMENT_REQUEST, type PaymentRequest } from './types';

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/design', () => ({
  Button: jest.requireActual('@/design/components/button').Button,
  Badge: 'Badge',
  Text: 'Text',
  Eyebrow: 'Text',
  Icon: 'Icon',
  Sheet: ({ visible, children, onClose }: { visible: boolean; children: React.ReactNode; onClose: () => void }) => {
    const { createElement: h, Fragment: F } = jest.requireActual('react');
    const { Button: B } = jest.requireActual('@/design/components/button');
    return visible ? h(F, null, h(B, { label: 'Close', onPress: onClose }), children) : null;
  },
  cn: (...classes: string[]) => classes.join(' '),
  Enter: { fade: () => undefined },
  useThemeColors: () => ({ brand: '#000', success: '#000' }),
}));

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
const hash = `0x${'ab'.repeat(32)}`;
const quote = jest.fn();
const commit = jest.fn();
const shareReceipt = jest.fn();
const RequestCard = walletContentTypes.find((type) => type.typeId === CONTENT_TYPE_PAYMENT_REQUEST)!.render!;
let tree: ReactTestRenderer;
let dispose: () => void;

beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true; });
afterAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });

beforeEach(async () => {
  quote.mockReset().mockResolvedValue({ rows: [{ label: 'Fee', value: '0.00001 ETH' }] });
  commit.mockReset().mockResolvedValue(hash);
  shareReceipt.mockReset().mockResolvedValue(undefined);
  dispose = registerChainStrategy({
    id: 'ethereum',
    name: 'Ethereum',
    transfer: { symbol: 'ETH', quote, commit },
  } as unknown as ChainStrategy);
  const props = {
    data: { amount: '0.1', symbol: 'ETH', to: `0x${'12'.repeat(20)}`, chain: 'ethereum' },
    fromMe: false,
    message: { conversationId: 'test-payment-errors' },
    context: { chat: { sendCustom: shareReceipt }, ui: { notify: jest.fn() } } as unknown as PluginContext,
  } as MessageRendererProps<PaymentRequest>;
  await act(async () => { tree = create(createElement(RequestCard, props)); });
});

afterEach(async () => {
  await act(async () => { tree.unmount(); });
  dispose();
});

function control(label: string) {
  const button = tree.root.findAllByType(Button).find((node) => node.props.label === label);
  if (!button) throw new Error(`No visible button: ${label}`);
  return button.findAll((node) => node.props.accessibilityRole === 'button')[0];
}

async function press(label: string) {
  const button = control(label);
  expect(button.props.accessibilityState.disabled).toBeFalsy();
  await act(async () => { button.props.onPress({}); });
}

it('removes an old fee quote and disables sending when a later review fails', async () => {
  await press('Pay 0.1 ETH');
  expect(control('Confirm and send').props.accessibilityState.disabled).toBeFalsy();
  await press('Close');
  quote.mockRejectedValueOnce(new Error('Network request failed'));

  await press('Pay 0.1 ETH');

  expect(control('Confirm and send').props.accessibilityState.disabled).toBe(true);
  expect(control('Confirm and send').props.onPress).toBeUndefined();
  const visible = JSON.stringify(tree.toJSON());
  expect(visible).not.toContain('0.00001 ETH');
  expect(visible).toMatch(/nothing was sent/i);
  expect(commit).not.toHaveBeenCalled();
});

it('keeps a sent payment non-payable when posting its receipt fails', async () => {
  shareReceipt.mockRejectedValueOnce(new Error('Network request failed'));
  await press('Pay 0.1 ETH');
  await press('Confirm and send');

  const visible = JSON.stringify(tree.toJSON());
  expect(visible).toContain(hash);
  expect(visible).toMatch(/payment was sent on Ethereum/i);
  expect(visible).toMatch(/do not send it again/i);
  expect(control('Confirm and send').props.accessibilityState.disabled).toBe(true);
  await press('Close');
  expect(tree.root.findAllByType(Button).some((node) => node.props.label.startsWith('Pay '))).toBe(false);
  expect(commit).toHaveBeenCalledTimes(1);
});
