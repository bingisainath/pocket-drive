import {
  ChevronRight,
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  Music,
  Presentation,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { authHeaders, urls } from '../api/drive';
import { hasThumbnail, kindOf, type Kind } from '../shared/lib/entries';
import { formatBytes, formatDate, plural } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';
import { ListItem } from './ui';

// Same icon set as the web app (lucide). Colours are the file-type accents from the web UI.
const ICON: Record<Kind, { icon: LucideIcon; color: string }> = {
  folder: { icon: Folder, color: '#f59e0b' },
  image: { icon: ImageIcon, color: '#10b981' },
  video: { icon: Film, color: '#8b5cf6' },
  audio: { icon: Music, color: '#ec4899' },
  pdf: { icon: FileText, color: '#ef4444' },
  text: { icon: FileText, color: '#64748b' },
  code: { icon: FileCode, color: '#0ea5e9' },
  archive: { icon: FileArchive, color: '#a16207' },
  doc: { icon: FileText, color: '#2563eb' },
  sheet: { icon: FileSpreadsheet, color: '#16a34a' },
  slides: { icon: Presentation, color: '#ea580c' },
  other: { icon: File, color: '#64748b' },
};

function Leading({ entry }: { entry: Entry }) {
  const { colors, radii } = useTheme();
  const [failed, setFailed] = useState(false);
  const { icon: Icon, color } = ICON[kindOf(entry)];
  const showThumb = hasThumbnail(entry) && !failed;
  return (
    <View style={[styles.icon, { borderRadius: radii.sm, backgroundColor: showThumb ? colors.surfaceAlt : `${color}22` }]}>
      {showThumb ? (
        // The Bearer token authorises the thumbnail request. FastImage (with disk cache) comes in a later slice.
        <Image source={{ uri: urls.thumb(entry), headers: authHeaders() }} style={styles.thumb} onError={() => setFailed(true)} />
      ) : (
        <Icon size={24} color={color} />
      )}
    </View>
  );
}

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
      leading={<Leading entry={entry} />}
      trailing={entry.isDir ? <ChevronRight size={20} color={colors.muted} /> : undefined}
      onPress={() => onPress(entry)}
    />
  );
}

export const EntryRow = memo(EntryRowBase);

const styles = StyleSheet.create({
  icon: { width: 48, height: 48, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 48, height: 48 },
});
