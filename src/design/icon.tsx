import { Ionicons } from '@expo/vector-icons';

export type IconName = keyof typeof Ionicons.glyphMap;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  className?: string;
}

export function Icon({ name, size = 20, color, className }: IconProps) {
  return <Ionicons name={name} size={size} color={color} className={className} />;
}
