/**
 * Non-colour design tokens. Spacing is a 4-px scale (same rhythm as the web app's Tailwind spacing);
 * radii and font sizes match the web app so the two feel like one product.
 */

/** Spacing on a 4-px scale. `space[4]` = 16 px. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** Corner radii. */
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/** Font sizes. */
export const fontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 16,
  xl: 20,
  xxl: 28,
  display: 32,
} as const;

/** Font weights that read the same across platforms. */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Minimum touch target (Android accessibility guidance is 48 dp). */
export const HIT_TARGET = 48;
