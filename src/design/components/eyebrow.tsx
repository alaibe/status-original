import { Text } from './text';
import { cn } from '../lib/cn';

const TONE = {
  muted: 'text-content-subtle',
  brand: 'text-brand',
  success: 'text-success',
  danger: 'text-danger',
} as const;

export interface EyebrowProps {
  children: string;
  tone?: keyof typeof TONE;
  className?: string;
}

export function Eyebrow({ children, tone = 'muted', className }: EyebrowProps) {
  return (
    <Text className={cn('font-mono text-micro uppercase tracking-wide', TONE[tone], className)}>
      {children}
    </Text>
  );
}
