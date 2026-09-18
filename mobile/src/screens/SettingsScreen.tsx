import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/drive';
import { useAuth } from '../auth/AuthContext';
import { StorageMeter } from '../components/StorageMeter';
import { AppText, Button } from '../components/ui';
import { useTheme } from '../theme';

export function SettingsScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, signOut } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;
  const qc = useQueryClient();

  const rescan = useMutation({
    mutationFn: () => api.rescan(),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['list'] });
      qc.invalidateQueries({ queryKey: ['storage'] });
      Alert.alert('Rescan complete', `Added ${result.inserted ?? 0}, removed ${result.removed ?? 0}.`);
    },
    onError: (err) => Alert.alert('Rescan failed', (err as Error).message),
  });

  const deleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'Your account, folder access and sign-ins are removed. Files you uploaded stay on the owner’s drive.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await api.deleteAccount().catch(() => {});
            await signOut(); // clears local data and returns to sign-in
          },
        },
      ],
    );
  };

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

      <StorageMeter />

      {user?.isOwner && (
        <Button label="Rescan storage" variant="secondary" onPress={() => rescan.mutate()} loading={rescan.isPending} />
      )}

      <AppText variant="caption" tone="muted">
        Uploads, camera backup, notifications and app lock arrive in later updates.
      </AppText>

      <Button label="Sign out" variant="secondary" onPress={signOut} />

      {user && !user.isOwner && <Button label="Delete account" variant="ghost" onPress={deleteAccount} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, gap: 4 },
});
