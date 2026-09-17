import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { AppText, Button } from '../components/ui';
import { useTheme } from '../theme';

export function SettingsScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, signOut } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + space[6], gap: space[4] }}
    >
      {user && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: space[4] }]}>
          <AppText variant="subtitle">{user.name ?? user.email}</AppText>
          <AppText variant="caption" tone="muted">
            {user.email}
            {user.isOwner ? ' · Owner' : ''}
          </AppText>
        </View>
      )}

      <AppText variant="caption" tone="muted">
        More settings — uploads, camera backup, notifications and app lock — arrive in later updates.
      </AppText>

      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, gap: 4 },
});
