import { Pressable } from './pressable';
import { Text } from './text';
import { useThemeColors } from '../hooks/use-theme-colors';
import { Icon } from '../icon';

export interface BackHeaderProps {
  label: string;
  onPress: () => void;
}

export function BackHeader({ label, onPress }: BackHeaderProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      onPress={onPress}
      className="flex-row items-center gap-1 px-2 py-2">
      <Icon name="chevron-back" size={24} color={colors.brand} />
      <Text className="text-brand">{label}</Text>
    </Pressable>
  );
}
