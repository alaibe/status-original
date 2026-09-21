import { View } from 'react-native';

import { Badge, Button, Sheet, Text } from '@/design';
import type { PluginContext } from '@/core/plugins/types';

import { describeRequest } from '../rpc';
import { useWalletConnectStore } from '../walletconnect';

export function makeApprovalOverlay(context: PluginContext) {
  return function ApprovalOverlay() {
    const head = useWalletConnectStore((s) => s.queue[0]);
    const approve = useWalletConnectStore((s) => s.approveHead);
    const reject = useWalletConnectStore((s) => s.rejectHead);

    if (!head) return null;

    const isProposal = head.kind === 'proposal';
    const metadata = isProposal ? head.proposal.params.proposer.metadata : null;
    const described = isProposal ? null : describeRequest(head);

    return (
      <Sheet
        visible
        onClose={reject}
        title={isProposal ? 'Connect to dapp' : (described?.title ?? 'Request')}>
        <View className="gap-3">
          <View className="gap-1 rounded-card bg-surface-sunken p-3">
            <Text className="font-semibold">{isProposal ? metadata?.name : head.dappName}</Text>
            {isProposal && metadata?.url ? <Text variant="caption">{metadata.url}</Text> : null}
            {described ? (
              <Text variant="footnote" className="mt-1">
                {described.detail}
              </Text>
            ) : null}
          </View>

          {isProposal ? (
            <View className="gap-1.5">
              <Text variant="caption">This dapp will be able to:</Text>
              <Text variant="footnote">• See your address</Text>
              <Text variant="footnote">• Ask you to sign messages and transactions</Text>
              <Text variant="caption" className="mt-1">
                Every signature still needs your approval here.
              </Text>
            </View>
          ) : (
            <Badge label="Signed on this device" tone="brand" />
          )}

          <Button
            label={isProposal ? 'Connect' : 'Approve'}
            fullWidth
            onPress={() => approve(context)}
          />
          <Button label="Reject" tone="neutral" fullWidth onPress={reject} />
        </View>
      </Sheet>
    );
  };
}
