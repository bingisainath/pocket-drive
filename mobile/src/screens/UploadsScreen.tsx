import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import { RotateCw, UploadCloud, X } from 'lucide-react-native';
import { useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, EmptyState, IconButton } from '../components/ui';
import type { MainTabsParamList } from '../navigation/types';
import { formatBytes } from '../shared/lib/format';
import { uploads, useUploads, type UploadTask } from '../uploads/store';
import { useTheme } from '../theme';

type Props = BottomTabScreenProps<MainTabsParamList, 'Uploads'>;

const STATUS_LABEL: Record<UploadTask['status'], string> = {
  queued: 'Waiting…',
  uploading: 'Uploading',
  reconnecting: 'Reconnecting…',
  done: 'Uploaded',
  error: 'Failed',
  cancelled: 'Cancelled',
};

export function UploadsScreen({ navigation }: Props) {
  const { colors, radii, space } = useTheme();
  const tasks = useUploads();
  const hasFinished = tasks.some((t) => t.status === 'done' || t.status === 'cancelled');

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: hasFinished
        ? () => <IconButton icon={X} accessibilityLabel="Clear finished" tone="muted" onPress={() => uploads.clearFinished()} />
        : undefined,
    });
  }, [navigation, hasFinished]);

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={UploadCloud}
        title="No uploads"
        message="Pick photos or files from a folder’s “+” menu and they’ll upload here."
      />
    );
  }

  return (
    <FlashList
      data={tasks}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ backgroundColor: colors.surface }}
      ItemSeparatorComponent={Separator}
      renderItem={({ item }) => {
        const pct = item.size > 0 ? Math.min(item.uploaded / item.size, 1) : item.status === 'done' ? 1 : 0;
        const active = item.status === 'uploading' || item.status === 'reconnecting' || item.status === 'queued';
        const failed = item.status === 'error' || item.status === 'cancelled';
        return (
          <View style={[styles.row, { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[2] }]}>
            <View style={styles.head}>
              <AppText variant="body" numberOfLines={1} style={styles.name}>
                {item.name}
              </AppText>
              {active && <IconButton icon={X} accessibilityLabel={`Cancel ${item.name}`} tone="muted" onPress={() => uploads.cancel(item.id)} />}
              {failed && <IconButton icon={RotateCw} accessibilityLabel={`Retry ${item.name}`} tone="primary" onPress={() => uploads.retry(item.id)} />}
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceAlt, borderRadius: radii.full }]}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.round(pct * 100)}%`, borderRadius: radii.full, backgroundColor: item.status === 'error' ? colors.danger : colors.primary },
                ]}
              />
            </View>
            <AppText variant="caption" tone={item.status === 'error' ? 'danger' : 'muted'}>
              {item.status === 'error' && item.error
                ? item.error
                : `${STATUS_LABEL[item.status]}${item.size > 0 ? ` · ${formatBytes(item.uploaded)} / ${formatBytes(item.size)}` : ''}`}
            </AppText>
          </View>
        );
      }}
    />
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={[styles.sep, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth },
  row: {},
  head: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, minWidth: 0, fontWeight: '500' },
  track: { height: 6, overflow: 'hidden' },
  fill: { height: 6 },
});
