import { useColorScheme } from 'react-native';
import { darkColors, lightColors, type Colors } from './colors';
import { fontSize, fontWeight, radii, space } from './tokens';

export type { Colors } from './colors';
export { space, radii, fontSize, fontWeight, HIT_TARGET } from './tokens';

export interface Theme {
  dark: boolean;
  colors: Colors;
  space: typeof space;
  radii: typeof radii;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
}

/** The full design system for the system's current light/dark mode. */
export function useTheme(): Theme {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    colors: dark ? darkColors : lightColors,
    space,
    radii,
    fontSize,
    fontWeight,
  };
}
