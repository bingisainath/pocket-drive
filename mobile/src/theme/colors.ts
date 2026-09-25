/**
 * Colour tokens for light and dark mode. Same slate/blue palette as the web app's Tailwind classes,
 * so the two apps look like one product. Semantic names (not raw slate-500) so screens never hard-code hex.
 */
export interface Colors {
  /** App background behind everything. */
  background: string;
  /** Cards, sheets, list backgrounds. */
  surface: string;
  /** A slightly raised/inset surface (input fields, pressed rows). */
  surfaceAlt: string;
  /** Primary text. */
  text: string;
  /** Secondary text, captions, icons at rest. */
  muted: string;
  /** Hairlines and dividers. */
  border: string;
  /** Brand blue for actions and links. */
  primary: string;
  /** Text/icon on top of `primary`. */
  primaryText: string;
  /** Subtle tinted background for selected/active states. */
  primarySoft: string;
  /** Destructive actions. */
  danger: string;
  /** Text/icon on top of `danger`. */
  dangerText: string;
  /** Success (e.g. an upload finished). */
  success: string;
  /** Scrim behind modals and bottom sheets. */
  overlay: string;
  /** Skeleton/placeholder blocks. */
  skeleton: string;
}

export const lightColors: Colors = {
  background: '#f8fafc', // slate-50
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9', // slate-100
  text: '#0f172a', // slate-900
  muted: '#64748b', // slate-500
  border: '#e2e8f0', // slate-200
  primary: '#2563eb', // blue-600
  primaryText: '#ffffff',
  primarySoft: '#eff6ff', // blue-50
  danger: '#dc2626', // red-600
  dangerText: '#ffffff',
  success: '#16a34a', // green-600
  overlay: 'rgba(15, 23, 42, 0.5)', // slate-900 @ 50%
  skeleton: '#e2e8f0',
};

export const darkColors: Colors = {
  background: '#020617', // slate-950
  surface: '#0f172a', // slate-900
  surfaceAlt: '#1e293b', // slate-800
  text: '#f1f5f9', // slate-100
  muted: '#94a3b8', // slate-400
  border: '#1e293b', // slate-800
  primary: '#3b82f6', // blue-500
  primaryText: '#ffffff',
  primarySoft: '#172554', // blue-950
  danger: '#f87171', // red-400
  dangerText: '#0f172a',
  success: '#4ade80', // green-400
  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: '#1e293b',
};
