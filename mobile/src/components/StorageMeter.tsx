import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { api } from '../api/drive';
import { formatBytes, plural } from '../shared/lib/format';
import { useTheme } from '../theme';
import { AppText } from './ui';

/** The drive's storage usage (owner) or just the upload limit (members). Backed by the ['storage'] query. */
export function StorageMeter() {
  const { colors, space, radii } = useTheme();
  const { data, isPending, isError } = useQuery({ queryKey: ['storage'], queryFn: () => api.storage() });

  if (isPending) return <ActivityIndicator color={colors.primary} />;
  if (isError || !data) return null;

  const card = { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, padding: space[4], gap: space[2] };

  // Members only get the upload limit; the device figures are the owner's.
  if (data.usedBytes == null || data.diskTotalBytes == null) {
    return (
      <View style={[styles.card, card]}>
        <AppText variant="subtitle">Storage</AppText>
        <AppText variant="caption" tone="muted">Upload limit {formatBytes(data.maxUploadBytes)} per file</AppText>
      </View>
    );
  }

  const used = data.usedBytes;
  const total = data.diskTotalBytes;
  const fraction = total > 0 ? Math.min(used / total, 1) : 0;

  return (
    <View style={[styles.card, card]}>
      <AppText variant="subtitle">Storage</AppText>
      <View style={[styles.track, { backgroundColor: colors.surfaceAlt, borderRadius: radii.full }]}>
        <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: colors.primary, borderRadius: radii.full }]} />
      </View>
      <AppText variant="caption" tone="muted">
        {formatBytes(used)} of {formatBytes(total)} used · {formatBytes(data.diskFreeBytes ?? total - used)} free
      </AppText>
      <AppText variant="caption" tone="muted">
        {plural(data.fileCount ?? 0, 'file')} · {plural(data.folderCount ?? 0, 'folder')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: 8 },
});
