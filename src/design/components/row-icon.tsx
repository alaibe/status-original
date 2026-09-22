import { View } from 'react-native';

import { cn } from '../lib/cn';
import { Icon, type IconName } from '../icon';

export type RowIconTone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal' | 'grey' | 'pink';

const FILL: Record<RowIconTone, string> = {
  blue: 'bg-[#3E63DD]',
  green: 'bg-[#30A46C]',
  orange: 'bg-[#F76B15]',
  red: 'bg-[#E5484D]',
  purple: 'bg-[#8E4EC6]',
  teal: 'bg-[#12A594]',
  grey: 'bg-[#8B8D98]',
  pink: 'bg-[#E93D82]',
};

export function RowIcon({ name, tone = 'grey' }: { name: IconName; tone?: RowIconTone }) {
  return (
    <View
      style={{ borderCurve: 'continuous' }}
      className={cn('h-7 w-7 items-center justify-center rounded-[8px]', FILL[tone])}>
      <Icon name={name} size={17} color="#FFFFFF" />
    </View>
  );
}
