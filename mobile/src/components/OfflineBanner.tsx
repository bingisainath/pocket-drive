import { CloudOff } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useOnline } from '../hooks/useOnline';
import { useTheme } from '../theme';
import { AppText } from './ui';

/** A quiet strip shown while offline, so cached data doesn't look live. */
export function OfflineBanner() {
  const online = useOnline();
  const { colors, space } = useTheme();
  if (online) return null;
  return (
    <View style={[styles.bar, { backgroundColor: colors.surfaceAlt, paddingVertical: space[2], paddingHorizontal: space[4], gap: space[2] }]}>
      <CloudOff size={14} color={colors.muted} />
      <AppText variant="caption" tone="muted">
        Offline — showing saved copy
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
