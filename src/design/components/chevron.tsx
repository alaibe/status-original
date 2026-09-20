import { Icon } from '../icon';
import { useThemeColors } from '../hooks/use-theme-colors';

export function Chevron() {
  const colors = useThemeColors();
  return <Icon name="chevron-forward" size={18} color={colors['content-subtle']} />;
}
