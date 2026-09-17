import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme';

interface Props {
  loading?: boolean;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Full-screen loading, empty and error states. */
export function StateView({ loading, title, message, actionLabel, onAction }: Props) {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {loading && <ActivityIndicator size="large" color={colors.primary} />}
      {title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
      {message && <Text style={[styles.message, { color: colors.muted }]}>{message}</Text>}
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryText }]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  message: { fontSize: 14, textAlign: 'center' },
  button: { marginTop: 12, paddingHorizontal: 20, height: 44, borderRadius: 12, justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
