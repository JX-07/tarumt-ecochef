# EcoChef design tokens

This package is the visual source of truth for EcoChef applications.

- Web imports `@ecochef/design-tokens/tokens.css`.
- Mobile imports `colors` and `typography` from `@ecochef/design-tokens`, and renders text through `apps/mobile/src/shared/components/themed-text.tsx`.

## Typography

Use only one body context per screen:

| Context | Mobile | Desktop |
| --- | ---: | ---: |
| Page title | 32px | 40px |
| Text-heavy body | 18px | 20px |
| Interaction-heavy body | 16px | 16px |
| Secondary text-heavy | 16px | 18px |
| Secondary interaction-heavy | 14px | 14px |
| Caption | 12px | 12px |

The secondary size is always 2px below its matching body size. Use text-heavy sizes for reading-focused screens such as recipe details, and interaction-heavy sizes for forms, dashboards, navigation, and controls. New screens should use these tokens rather than adding one-off colours or font sizes.

## Spacing and grids

- Mobile uses the 4-point spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, and 64px.
- Desktop uses a 12-column grid with 24px gutters and responsive outer margins between 32px and 60px.
- Component padding, internal gaps, button heights, and card margins must reference `spacing` / `--ec-space-*` rather than use one-off values.

## Fonts, line heights and exported slips

Web controls inherit `--ec-font-sans`. Native text and inputs use `typography.nativeFontFamily` through the shared `Text` and `TextInput` components, which forward native refs and accessibility props. Use a shared token for any intentional font override, such as `typography.monospace` for codes.

Web line-height variants are declared in both `typography.lineHeight` and matching `--ec-line-height-*` variables. Preserve the chosen context by referring to these tokens instead of repeating literal ratios in feature styles.

PDF order slips use `typography.print.fontFamily` (the standard PDF Helvetica font) and point sizes under `typography.print.size`. Convert semantic `colors` tokens to PDF RGB channels rather than declaring a separate print palette.

Run `node scripts/check-theme-usage.mjs` from the repository root to check app source, and `node --test scripts/check-theme-usage.test.mjs` to verify that the checker rejects representative violations. These checks validate source usage; they do not replace visual or accessibility testing on devices and browsers.
