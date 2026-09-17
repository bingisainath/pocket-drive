import { memo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { urls } from '../api/drive';
import { hasThumbnail, kindOf, type Kind } from '../shared/lib/entries';
import { formatBytes, formatDate, plural } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useColors } from '../theme';

// Placeholder type badges until an icon set is chosen (e.g. react-native-vector-icons or lucide-react-native).
const BADGE: Record<Kind, { label: string; color: string }> = {
  folder: { label: '📁', color: '#f59e0b' },
  image: { label: '🖼', color: '#10b981' },
  video: { label: '🎬', color: '#8b5cf6' },
  audio: { label: '🎵', color: '#ec4899' },
  pdf: { label: 'PDF', color: '#ef4444' },
  text: { label: 'TXT', color: '#64748b' },
  code: { label: '</>', color: '#0ea5e9' },
  archive: { label: 'ZIP', color: '#a16207' },
  doc: { label: 'DOC', color: '#2563eb' },
  sheet: { label: 'XLS', color: '#16a34a' },
  slides: { label: 'PPT', color: '#ea580c' },
  other: { label: 'FILE', color: '#64748b' },
};

interface Props {
  entry: Entry;
  onPress: (entry: Entry) => void;
}

function EntryRowBase({ entry, onPress }: Props) {
  const colors = useColors();
  const [thumbFailed, setThumbFailed] = useState(false);
  const kind = kindOf(entry);
  const badge = BADGE[kind];
  const detail = entry.isDir
    ? entry.childCount === null
      ? 'Folder'
      : plural(entry.childCount, 'item')
    : `${formatBytes(entry.size)} · ${formatDate(entry.createdAt)}`;

  return (
    <Pressable
      onPress={() => onPress(entry)}
      accessibilityRole="button"
      accessibilityLabel={entry.name}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.border : colors.surface }]}
    >
      <View style={[styles.icon, { backgroundColor: `${badge.color}22` }]}>
        {hasThumbnail(entry) && !thumbFailed ? (
          // The session cookie from sign-in is sent with image requests too.
          <Image source={{ uri: urls.thumb(entry) }} style={styles.thumb} onError={() => setThumbFailed(true)} />
        ) : (
          <Text style={[styles.badge, { color: badge.color }]}>{badge.label}</Text>
        )}
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
          {entry.name}
        </Text>
        <Text numberOfLines={1} style={[styles.detail, { color: colors.muted }]}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}

export const EntryRow = memo(EntryRowBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  icon: { width: 48, height: 48, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 48, height: 48 },
  badge: { fontSize: 13, fontWeight: '700' },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500' },
  detail: { fontSize: 13, marginTop: 2 },
});
