import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/drive';
import { useAuth } from '../auth/AuthContext';
import { StorageMeter } from '../components/StorageMeter';
import { AppText, Button } from '../components/ui';
import { useTheme } from '../theme';
import { disableCameraBackup, enableCameraBackup } from '../uploads/cameraBackup';
import { getCameraBackup, getWifiOnly, setWifiOnly } from '../uploads/native';

export function SettingsScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, signOut } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;
  const qc = useQueryClient();

  const [wifiOnly, setWifiOnlyState] = useState(true);
  const [cameraBackup, setCameraBackupState] = useState(false);
  const [savingBackup, setSavingBackup] = useState(false);
  useEffect(() => {
    getWifiOnly().then(setWifiOnlyState).catch(() => {});
    getCameraBackup().then((s) => setCameraBackupState(s.enabled)).catch(() => {});
  }, []);
  const toggleWifiOnly = (value: boolean) => {
    setWifiOnlyState(value); // native applies it to the next scheduled upload
    setWifiOnly(value);
  };
  const toggleCameraBackup = async (value: boolean) => {
    setSavingBackup(true);
    try {
      if (value) {
        await enableCameraBackup(); // asks for permission + creates the "Camera Backup" folder
        setCameraBackupState(true);
      } else {
        disableCameraBackup();
        setCameraBackupState(false);
      }
    } catch (err) {
      setCameraBackupState(false);
      Alert.alert('Camera backup', (err as Error).message);
    } finally {
      setSavingBackup(false);
    }
  };

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

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: space[4] }]}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <AppText variant="body">Upload on Wi-Fi only</AppText>
            <AppText variant="caption" tone="muted">
              When on, background uploads wait for Wi-Fi. Turn off to use mobile data too.
            </AppText>
          </View>
          <Switch
            value={wifiOnly}
            onValueChange={toggleWifiOnly}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            accessibilityLabel="Upload on Wi-Fi only"
          />
        </View>

        <View style={[styles.row, styles.rowDivider, { borderTopColor: colors.border }]}>
          <View style={styles.rowText}>
            <AppText variant="body">Back up photos &amp; videos</AppText>
            <AppText variant="caption" tone="muted">
              New photos and videos upload automatically to “Camera Backup”.
            </AppText>
          </View>
          <Switch
            value={cameraBackup}
            onValueChange={toggleCameraBackup}
            disabled={savingBackup}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            accessibilityLabel="Back up photos and videos"
          />
        </View>
      </View>

      <AppText variant="caption" tone="muted">
        Camera backup, notifications and app lock arrive in later updates.
      </AppText>

      <Button label="Sign out" variant="secondary" onPress={signOut} />

      {user && !user.isOwner && <Button label="Delete account" variant="ghost" onPress={deleteAccount} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 14, paddingTop: 14 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
});
