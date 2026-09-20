// The config is plain JS with loose Tailwind types; narrow it to what we assert on.
import { cn, FONT_SIZE_NAMES } from './cn';

// The Tailwind config is CommonJS, which is what Tailwind itself requires.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tailwindConfig = require('../../../tailwind.config.js') as {
  theme: { extend: { fontSize: Record<string, unknown> } };
};

describe('cn', () => {
  it('lets a later colour override an earlier one', () => {
    // The bug this guards: unconfigured tailwind-merge classified
    // `text-brand-on` as a font size, dropped both colours, and every button
    // label rendered in the default colour instead of white.
    expect(cn('text-content', 'text-brand-on')).toBe('text-brand-on');
    expect(cn('text-content', 'text-brand')).toBe('text-brand');
  });

  it('keeps a font size and a colour together', () => {
    expect(cn('text-body text-content', 'text-brand-on')).toBe('text-body text-brand-on');
  });

  it('still collapses two font sizes', () => {
    expect(cn('text-body', 'text-footnote')).toBe('text-footnote');
  });

  it('resolves the real Button composition', () => {
    const variant = 'text-body font-sans text-content';
    const override = 'text-brand-on font-semibold text-body';
    expect(cn(variant, override)).toBe('font-sans text-brand-on font-semibold text-body');
  });

  it('overrides background and border colours', () => {
    expect(cn('bg-surface', 'bg-brand')).toBe('bg-brand');
    expect(cn('border-line', 'border-danger')).toBe('border-danger');
  });
});

describe('token scales stay in sync with tailwind.config.js', () => {
  it('font size names match the config', () => {
    const configured = Object.keys(tailwindConfig.theme.extend.fontSize);
    expect([...FONT_SIZE_NAMES].sort()).toEqual(configured.sort());
  });
});
