import { useColorScheme } from 'react-native';

const light = {
  background: '#f8fafc',
  surface: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  primary: '#2563eb',
  primaryText: '#ffffff',
  danger: '#dc2626',
};

const dark: typeof light = {
  background: '#020617',
  surface: '#0f172a',
  text: '#f1f5f9',
  muted: '#94a3b8',
  border: '#1e293b',
  primary: '#3b82f6',
  primaryText: '#ffffff',
  danger: '#f87171',
};

export type Colors = typeof light;

/** Colours for the system's light or dark mode (same palette as the web app's Tailwind slate/blue). */
export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
