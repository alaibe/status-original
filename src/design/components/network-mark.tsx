import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { NETWORK_MARKS } from '../network-marks';
import { Text } from './text';

/** A network's logo in a small disc, for the corner of an avatar or a folder. */
export function NetworkMark({ network, size = 16 }: { network: string; size?: number }) {
  const mark = NETWORK_MARKS[network];
  const glyph = Math.round(size * 0.62);
  return (
    <View
      accessibilityLabel={network}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: mark?.color ?? '#6B7280',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {mark?.path ? (
        <Svg width={glyph} height={glyph} viewBox="0 0 24 24">
          <Path d={mark.path} fill="#FFFFFF" />
        </Svg>
      ) : (
        <Text
          style={{ fontSize: size * 0.6, lineHeight: size * 0.75, color: '#FFFFFF' }}
          className="font-bold">
          {network === 'Slack' ? '#' : network.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
