import { ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { formatBytes, formatDate, plural } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';
import { FileThumb } from './FileThumb';
import { ListItem } from './ui';

interface Props {
  entry: Entry;
  onPress: (entry: Entry) => void;
}

function EntryRowBase({ entry, onPress }: Props) {
  const { colors } = useTheme();
  const detail = entry.isDir
    ? entry.childCount === null
      ? 'Folder'
      : plural(entry.childCount, 'item')
    : `${formatBytes(entry.size)} · ${formatDate(entry.createdAt)}`;

  return (
    <ListItem
      title={entry.name}
      subtitle={detail}
      leading={<FileThumb entry={entry} size={48} />}
      trailing={entry.isDir ? <ChevronRight size={20} color={colors.muted} /> : undefined}
      onPress={() => onPress(entry)}
    />
  );
}

export const EntryRow = memo(EntryRowBase);
