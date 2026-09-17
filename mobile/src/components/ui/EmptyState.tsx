import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { AppText } from './AppText';
import { Button } from './Button';

interface Props {
  /** Optional lucide icon shown above the text. */
  icon?: LucideIcon;
  /** Show a spinner instead of an icon (loading state). */
  loading?: boolean;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Full-screen loading, empty and error states — the one place these are styled. */
export function EmptyState({ icon: Icon, loading, title, message, actionLabel, onAction }: Props) {
  const { colors, space } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.background, padding: space[6], gap: space[2] }]}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        Icon && <Icon size={44} color={colors.muted} strokeWidth={1.5} />
      )}
      {title && (
        <AppText variant="subtitle" style={styles.centered}>
          {title}
        </AppText>
      )}
      {message && (
        <AppText variant="body" tone="muted" style={styles.centered}>
          {message}
        </AppText>
      )}
      {actionLabel && onAction && (
        <Button label={actionLabel} onPress={onAction} variant="secondary" fullWidth={false} style={styles.action} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
  action: { marginTop: 12 },
});
