import { Pressable, type PressScaleProps } from './pressable';
import { useThemeColors } from '../hooks/use-theme-colors';
import { Icon, type IconName } from '../icon';
import { cn } from '../lib/cn';

export interface IconButtonProps extends Omit<PressScaleProps, 'children'> {
  icon: IconName;
  label: string;
  tone?: 'brand' | 'muted';
  size?: number;
}

export function IconButton({
  icon,
  label,
  tone = 'muted',
  size = 22,
  className,
  ...props
}: IconButtonProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn('size-tap items-center justify-center rounded-pill', className)}
      {...props}>
      <Icon
        name={icon}
        size={size}
        color={tone === 'brand' ? colors.brand : colors['content-muted']}
      />
    </Pressable>
  );
}
