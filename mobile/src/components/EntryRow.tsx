import { ChevronRight, Circle, CircleCheck, EllipsisVertical } from 'lucide-react-native';
import { memo } from 'react';
import { formatBytes, formatDate, plural } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';
import { FileThumb } from './FileThumb';
import { IconButton, ListItem } from './ui';

interface Props {
  entry: Entry;
  onPress: (entry: Entry) => void;
  /** Long-press: starts (or extends) a multi-selection. */
  onLongPress?: (entry: Entry) => void;
  /** The ⋮ button: this entry's own actions sheet. */
  onMore?: (entry: Entry) => void;
  /** A selection is in progress: rows show a checkbox instead of ⋮. */
  selecting?: boolean;
  selected?: boolean;
}

function EntryRowBase({ entry, onPress, onLongPress, onMore, selecting = false, selected = false }: Props) {
  const { colors } = useTheme();
  const detail = entry.isDir
    ? entry.childCount === null
      ? 'Folder'
      : plural(entry.childCount, 'item')
    : `${formatBytes(entry.size)} · ${formatDate(entry.createdAt)}`;

  const trailing = selecting ? (
    selected ? (
      <CircleCheck size={22} color={colors.primaryText} fill={colors.primary} />
    ) : (
      <Circle size={22} color={colors.muted} />
    )
  ) : onMore ? (
    <IconButton icon={EllipsisVertical} accessibilityLabel={`More actions for ${entry.name}`} tone="muted" size={20} onPress={() => onMore(entry)} />
  ) : entry.isDir ? (
    <ChevronRight size={20} color={colors.muted} />
  ) : undefined;

  return (
    <ListItem
      title={entry.name}
      subtitle={detail}
      leading={<FileThumb entry={entry} size={48} />}
      trailing={trailing}
      selected={selected}
      accessibilityLabel={selecting ? `${entry.name}, ${selected ? 'selected' : 'not selected'}` : undefined}
      onPress={() => onPress(entry)}
      onLongPress={onLongPress ? () => onLongPress(entry) : undefined}
    />
  );
}

export const EntryRow = memo(EntryRowBase);
