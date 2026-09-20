const { platformSelect } = require('nativewind/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Every colour is a CSS variable so a theme swap is one class change.
        // `<alpha-value>` keeps `bg-surface/60` style opacity modifiers working.
        brand: {
          DEFAULT: 'rgb(var(--color-brand) / <alpha-value>)',
          soft: 'rgb(var(--color-brand-soft) / <alpha-value>)',
          strong: 'rgb(var(--color-brand-strong) / <alpha-value>)',
          on: 'rgb(var(--color-brand-on) / <alpha-value>)',
        },
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          raised: 'rgb(var(--color-surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--color-surface-sunken) / <alpha-value>)',
        },
        content: {
          DEFAULT: 'rgb(var(--color-content) / <alpha-value>)',
          muted: 'rgb(var(--color-content-muted) / <alpha-value>)',
          subtle: 'rgb(var(--color-content-subtle) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--color-line) / <alpha-value>)',
          strong: 'rgb(var(--color-line-strong) / <alpha-value>)',
        },
        bubble: {
          out: 'rgb(var(--color-bubble-out) / <alpha-value>)',
          'out-on': 'rgb(var(--color-bubble-out-on) / <alpha-value>)',
          in: 'rgb(var(--color-bubble-in) / <alpha-value>)',
          'in-on': 'rgb(var(--color-bubble-in-on) / <alpha-value>)',
        },
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
      },
      borderRadius: {
        card: '18px',
        bubble: '20px',
        field: '14px',
        pill: '999px',
      },
      fontFamily: {
        // React Native's `fontFamily` takes a single concrete family name — a
        // CSS variable or a comma-separated stack is rejected at the native
        // prop bridge ("Value is an object, expected a String"). So the web
        // keeps its variable-driven stack and native gets real family names.
        sans: platformSelect({
          ios: 'System',
          android: 'sans-serif',
          default: 'var(--font-display)',
        }),
        mono: platformSelect({
          ios: 'Menlo',
          android: 'monospace',
          default: 'var(--font-mono)',
        }),
        rounded: platformSelect({
          // iOS exposes the rounded system face under this name.
          ios: 'ui-rounded',
          android: 'sans-serif-medium',
          default: 'var(--font-rounded)',
        }),
      },
      fontSize: {
        // A restrained type scale — messengers live in a narrow band.
        // Body is 16px: the minimum for readable body copy on a phone. Only
        // metadata (timestamps, counts, labels) sits below it.
        micro: ['11px', { lineHeight: '14px' }],
        caption: ['13px', { lineHeight: '17px' }],
        footnote: ['15px', { lineHeight: '20px' }],
        body: ['16px', { lineHeight: '22px' }],
        title: ['18px', { lineHeight: '24px' }],
        headline: ['24px', { lineHeight: '30px' }],
        display: ['34px', { lineHeight: '40px' }],
      },
      spacing: {
        gutter: '16px',
        tap: '44px', // Apple's minimum accessible hit target
      },
    },
  },
  plugins: [],
};
