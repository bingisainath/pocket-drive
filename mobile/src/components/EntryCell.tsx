import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { formatBytes, plural } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';
import { FileThumb } from './FileThumb';
import { AppText } from './ui';

interface Props {
  entry: Entry;
  /** The column (tile) width in px, computed by the grid from the screen width. */
  tile: number;
  onPress: (entry: Entry) => void;
  onLongPress?: (entry: Entry) => void;
}

const PAD = 8;

function EntryCellBase({ entry, tile, onPress, onLongPress }: Props) {
  const { space } = useTheme();
  const detail = entry.isDir
    ? entry.childCount === null
      ? 'Folder'
      : plural(entry.childCount, 'item')
    : formatBytes(entry.size);

  return (
    <Pressable
      onPress={() => onPress(entry)}
      onLongPress={onLongPress ? () => onLongPress(entry) : undefined}
      accessibilityRole="button"
      accessibilityLabel={entry.name}
      style={({ pressed }) => [styles.cell, { width: tile, padding: PAD, gap: space[1], opacity: pressed ? 0.7 : 1 }]}
    >
      <FileThumb entry={entry} size={tile - PAD * 2} />
      <AppText variant="caption" numberOfLines={1}>
        {entry.name}
      </AppText>
      <AppText variant="caption" tone="muted" numberOfLines={1}>
        {detail}
      </AppText>
    </Pressable>
  );
}

export const EntryCell = memo(EntryCellBase);

const styles = StyleSheet.create({
  cell: { alignItems: 'flex-start' },
});
