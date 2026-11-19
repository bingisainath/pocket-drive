import { Circle, CircleCheck } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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
  /** Long-press: starts (or extends) a multi-selection. */
  onLongPress?: (entry: Entry) => void;
  /** A selection is in progress: cells show a checkbox over the thumbnail. */
  selecting?: boolean;
  selected?: boolean;
}

const PAD = 8;

function EntryCellBase({ entry, tile, onPress, onLongPress, selecting = false, selected = false }: Props) {
  const { colors, radii, space } = useTheme();
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
      accessibilityLabel={selecting ? `${entry.name}, ${selected ? 'selected' : 'not selected'}` : entry.name}
      style={({ pressed }) => [
        styles.cell,
        {
          width: tile,
          padding: PAD,
          gap: space[1],
          opacity: pressed ? 0.7 : 1,
          borderRadius: radii.md,
          backgroundColor: selected ? colors.primarySoft : 'transparent',
        },
      ]}
    >
      <View>
        <FileThumb entry={entry} size={tile - PAD * 2} />
        {selecting && (
          <View style={styles.check}>
            {selected ? (
              <CircleCheck size={24} color={colors.primaryText} fill={colors.primary} />
            ) : (
              <Circle size={24} color="#fff" fill="rgba(0,0,0,0.25)" />
            )}
          </View>
        )}
      </View>
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
  check: { position: 'absolute', top: 6, right: 6 },
});
