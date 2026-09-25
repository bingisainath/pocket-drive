import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { HIT_TARGET, useTheme, type Colors } from '../../theme';

interface Props {
  icon: LucideIcon;
  /** Required for TalkBack — an icon alone tells a screen-reader user nothing. */
  accessibilityLabel: string;
  onPress: () => void;
  size?: number;
  tone?: keyof Pick<Colors, 'text' | 'muted' | 'primary' | 'danger'>;
  disabled?: boolean;
  style?: ViewStyle;
}

/** A tappable icon with a proper touch target and screen-reader label. */
export function IconButton({ icon: Icon, accessibilityLabel, onPress, size = 22, tone = 'text', disabled = false, style }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [styles.base, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }, style]}
    >
      <Icon size={size} color={colors[tone]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minWidth: HIT_TARGET, minHeight: HIT_TARGET, alignItems: 'center', justifyContent: 'center' },
});
