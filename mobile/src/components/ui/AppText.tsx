import { StyleSheet, Text, type TextProps } from 'react-native';
import { useTheme, type Colors } from '../../theme';

export type TextVariant = 'display' | 'title' | 'subtitle' | 'body' | 'label' | 'caption';
export type TextTone = 'default' | 'muted' | 'primary' | 'danger' | 'onPrimary' | 'success';

interface Props extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
}

const TONE: Record<TextTone, keyof Colors> = {
  default: 'text',
  muted: 'muted',
  primary: 'primary',
  danger: 'danger',
  onPrimary: 'primaryText',
  success: 'success',
};

/**
 * The one text component. Screens pick a `variant` (size/weight) and `tone` (colour) instead of
 * hand-rolling styles, so type stays consistent and themed. Font scaling is on by default for
 * accessibility; pass allowFontScaling={false} only for fixed-width UI like badges.
 */
export function AppText({ variant = 'body', tone = 'default', style, ...rest }: Props) {
  const theme = useTheme();
  return <Text {...rest} style={[styles[variant], { color: theme.colors[TONE[tone]] }, style]} />;
}

const styles = StyleSheet.create({
  display: { fontSize: 32, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 13, fontWeight: '400' },
});
