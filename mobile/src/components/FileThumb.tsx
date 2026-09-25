import {
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
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { authHeaders, urls } from '../api/drive';
import { hasThumbnail, kindOf, type Kind } from '../shared/lib/entries';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';

// Same icon set as the web app (lucide), with the web UI's file-type accent colours.
export const KIND_ICON: Record<Kind, { icon: LucideIcon; color: string }> = {
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

/** A file's thumbnail (Bearer-authorised) or, if it has none, its tinted type icon. */
export function FileThumb({ entry, size = 48 }: { entry: Entry; size?: number }) {
  const { colors, radii } = useTheme();
  const [failed, setFailed] = useState(false);
  const { icon: Icon, color } = KIND_ICON[kindOf(entry)];
  const showThumb = hasThumbnail(entry) && !failed;
  return (
    <View
      style={[
        styles.box,
        { width: size, height: size, borderRadius: radii.sm, backgroundColor: showThumb ? colors.surfaceAlt : `${color}22` },
      ]}
    >
      {showThumb ? (
        <Image
          source={{ uri: urls.thumb(entry), headers: authHeaders() }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon size={Math.round(size * 0.5)} color={color} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
