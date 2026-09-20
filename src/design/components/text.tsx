import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { cn } from '../lib/cn';

const VARIANTS = {
  display: 'text-display font-sans font-semibold tracking-tight text-content',
  headline: 'text-headline font-sans font-semibold tracking-tight text-content',
  title: 'text-title font-sans font-semibold text-content',
  body: 'text-body font-sans text-content',
  bodyMuted: 'text-body font-sans text-content-muted',
  footnote: 'text-footnote font-sans text-content-muted',
  caption: 'text-caption font-sans text-content-subtle',
  micro: 'text-micro font-sans text-content-subtle',
  mono: 'text-footnote font-mono text-content-muted',
} as const;

export type TextVariant = keyof typeof VARIANTS;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  className?: string;
}

export function Text({ variant = 'body', className, ...props }: TextProps) {
  return <RNText className={cn(VARIANTS[variant], className)} {...props} />;
}
