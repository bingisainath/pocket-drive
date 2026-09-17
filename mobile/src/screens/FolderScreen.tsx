import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { FolderOpen } from 'lucide-react-native';
import { useCallback } from 'react';
import { Alert, RefreshControl, StyleSheet, View } from 'react-native';
import { EntryRow } from '../components/EntryRow';
import { EmptyState } from '../components/ui';
import { useFolder } from '../hooks/useFolder';
import type { FilesStackParamList } from '../navigation/types';
import { formatBytes } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';

type Props = NativeStackScreenProps<FilesStackParamList, 'Folder'>;

export function FolderScreen({ navigation, route }: Props) {
  const { path } = route.params;
  const { colors } = useTheme();
  const { entries, loading, refreshing, error, refresh } = useFolder(path);

  const open = useCallback(
    (entry: Entry) => {
      if (entry.isDir) {
        navigation.push('Folder', { path: entry.path, title: entry.name });
        return;
      }
      // TODO(Phase 3): file viewer (photo previews, HLS video, PDF, text).
      Alert.alert(entry.name, `${formatBytes(entry.size)}\n\nThe file viewer is the next thing to build.`);
    },
    [navigation],
  );

  if (loading) return <EmptyState loading />;
  if (error && entries.length === 0) {
    return <EmptyState title="Couldn’t load this folder" message={error} actionLabel="Try again" onAction={refresh} />;
  }

  return (
    <FlashList
      data={entries}
      keyExtractor={(entry) => String(entry.id)}
      renderItem={({ item }) => <EntryRow entry={item} onPress={open} />}
      ItemSeparatorComponent={Separator}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />}
      contentContainerStyle={{ backgroundColor: colors.surface }}
      ListEmptyComponent={
        <EmptyState icon={FolderOpen} title="Nothing here yet" message="Files you add to this folder will show up here." />
      }
    />
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={[styles.separator, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 76 },
});
