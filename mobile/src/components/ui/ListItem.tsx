import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { AppText } from './AppText';

interface Props {
  title: string;
  subtitle?: string;
  /** Leading visual: an icon, thumbnail or badge. */
  leading?: ReactNode;
  /** Trailing visual: a chevron, switch or menu button. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Overrides the default TalkBack label (defaults to the title). */
  accessibilityLabel?: string;
}

/** A standard row: leading visual, title + optional subtitle, optional trailing. Used across all lists. */
export function ListItem({ title, subtitle, leading, trailing, onPress, accessibilityLabel }: Props) {
  const { colors, space } = useTheme();
  const body = (
    <View style={[styles.row, { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[3] }]}>
      {leading}
      <View style={styles.text}>
        <AppText variant="body" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
        {subtitle != null && (
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </AppText>
        )}
      </View>
      {trailing}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontWeight: '500' },
});
