import { View } from 'react-native';

import { useThemeColors } from '../hooks/use-theme-colors';
import { cn } from '../lib/cn';
import { Icon, type IconName } from '../icon';
import { ListItem } from './list-item';
import { closeSheetThen, Sheet, type SheetProps } from './sheet';
import { Text } from './text';

export interface SheetAction {
  label: string;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  icon?: IconName;
  /** Shows a checkmark, for sheets that pick one of several. */
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}

export interface ActionSheetProps extends Omit<SheetProps, 'children'> {
  /** Picking one closes the sheet before it runs. */
  actions: SheetAction[];
}

export function ActionSheet({ actions, ...sheet }: ActionSheetProps) {
  const colors = useThemeColors();

  return (
    <Sheet {...sheet}>
      <View style={{ borderCurve: 'continuous' }} className="overflow-hidden rounded-card bg-surface-raised">
        {actions.map((action, i) => {
          const color = action.tone && action.tone !== 'neutral' ? colors[action.tone] : colors.content;
          return (
            <ListItem
              key={`${action.label}-${i}`}
              testID={action.testID}
              accessibilityLabel={action.label}
              className={cn('px-4', i > 0 && 'border-t border-line')}
              title={
                <Text className="font-medium" style={{ color }}>
                  {action.label}
                </Text>
              }
              leading={action.icon ? <Icon name={action.icon} size={20} color={color} /> : undefined}
              trailing={
                action.selected ? <Icon name="checkmark" size={18} color={colors.brand} /> : undefined
              }
              onPress={() => closeSheetThen(sheet, action.onPress)}
            />
          );
        })}
      </View>
    </Sheet>
  );
}
