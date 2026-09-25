import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { ArrowUpDown, Check, Download, FileUp, FolderOpen, FolderPlus, ImageUp, LayoutGrid, List, Plus, Search, Trash2, UserPlus } from 'lucide-react-native';
import { useCallback, useLayoutEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Breadcrumbs, type Crumb } from '../components/Breadcrumbs';
import { EntryCell } from '../components/EntryCell';
import { EntryRow } from '../components/EntryRow';
import { OfflineBanner } from '../components/OfflineBanner';
import { AppText, Button, EmptyState, IconButton, Sheet, TextField } from '../components/ui';
import { useFolder } from '../hooks/useFolder';
import { useFolderActions } from '../hooks/useFolderActions';
import { useSortOrder, useViewMode } from '../lib/prefs';
import type { FilesStackParamList } from '../navigation/types';
import { SORT_LABELS, SORTS } from '../shared/lib/entries';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';
import { downloadFile } from '../uploads/native';
import { pickDocuments, pickPhotos } from '../uploads/pick';
import { uploads } from '../uploads/store';
import { urls } from '../api/drive';

type Props = NativeStackScreenProps<FilesStackParamList, 'Folder'>;

const COLUMNS = 3;

export function FolderScreen({ navigation, route }: Props) {
  const { path } = route.params;
  const { colors, space } = useTheme();
  const { width } = useWindowDimensions();
  const [viewMode, setViewMode] = useViewMode();
  const [sortOrder, setSortOrder] = useSortOrder();
  const [sortOpen, setSortOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [actionEntry, setActionEntry] = useState<Entry | null>(null);
  const { entries, loading, refreshing, error, refresh, access } = useFolder(path, sortOrder);
  const { createFolder, remove } = useFolderActions(path);
  const tile = Math.floor(width / COLUMNS);
  const canWrite = access?.canWrite ?? false;

  const open = useCallback(
    (entry: Entry) => {
      if (entry.isDir) navigation.push('Folder', { path: entry.path, title: entry.name });
      else navigation.push('Viewer', { entry });
    },
    [navigation],
  );

  const onLongPress = useCallback((entry: Entry) => setActionEntry(entry), []);

  const confirmDelete = (entry: Entry) => {
    setActionEntry(null);
    Alert.alert(
      `Delete “${entry.name}”?`,
      entry.isDir ? 'This deletes the folder and everything inside it.' : 'This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(entry.id) },
      ],
    );
  };

  const downloadEntry = (entry: Entry) => {
    setActionEntry(null);
    downloadFile(urls.download(entry), entry.name, entry.mime)
      .then(() => Alert.alert('Download started', `Saving “${entry.name}” to your Downloads.`))
      .catch((err) => Alert.alert('Download failed', (err as Error).message));
  };

  const uploadPicked = async (pick: () => Promise<Awaited<ReturnType<typeof pickPhotos>>>) => {
    setAddOpen(false);
    try {
      const files = await pick();
      if (files.length) uploads.add(path, files); // the floating upload panel shows progress
    } catch (err) {
      Alert.alert('Couldn’t pick files', (err as Error).message);
    }
  };

  const submitNewFolder = () => {
    const name = folderName.trim();
    if (!name) return;
    createFolder.mutate(name, {
      onSuccess: () => {
        setNewFolderOpen(false);
        setFolderName('');
      },
      onError: (err) => Alert.alert('Couldn’t create folder', (err as Error).message),
    });
  };

  // Jump to a breadcrumb: pop back to that folder if it's in the stack, otherwise open it fresh.
  const goToCrumb = useCallback(
    (crumb: Crumb) => {
      const routes = navigation.getState().routes;
      let target = -1;
      for (let i = routes.length - 1; i >= 0; i--) {
        if (routes[i].name === 'Folder' && ((routes[i].params as { path?: string })?.path ?? '') === crumb.path) {
          target = i;
          break;
        }
      }
      if (target >= 0) {
        const popCount = routes.length - 1 - target;
        if (popCount > 0) navigation.pop(popCount);
      } else {
        navigation.push('Folder', { path: crumb.path, title: crumb.name });
      }
    },
    [navigation],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components -- headerRight is a render prop, re-set when viewMode changes
      headerRight: () => (
        <View style={styles.headerRow}>
          <IconButton icon={Search} accessibilityLabel="Search" tone="primary" onPress={() => navigation.navigate('Search')} />
          <IconButton icon={ArrowUpDown} accessibilityLabel="Change sort order" tone="primary" onPress={() => setSortOpen(true)} />
          <IconButton
            icon={viewMode === 'grid' ? List : LayoutGrid}
            accessibilityLabel={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
            tone="primary"
            onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          />
          {canWrite && <IconButton icon={Plus} accessibilityLabel="Add" tone="primary" onPress={() => setAddOpen(true)} />}
        </View>
      ),
    });
  }, [navigation, viewMode, setViewMode, canWrite]);

  if (loading) return <EmptyState loading />;
  if (error && entries.length === 0) {
    return <EmptyState title="Couldn’t load this folder" message={error} actionLabel="Try again" onAction={refresh} />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface }]}>
      <OfflineBanner />
      <Breadcrumbs path={path} isOwner={access?.isOwner ?? false} accessRoot={access?.accessRoot ?? null} onNavigate={goToCrumb} />
      <FlashList
        key={viewMode} // a numColumns change needs a fresh list instance
        data={entries}
        numColumns={viewMode === 'grid' ? COLUMNS : 1}
        keyExtractor={(entry) => String(entry.id)}
        renderItem={({ item }) =>
          viewMode === 'grid' ? (
            <EntryCell entry={item} tile={tile} onPress={open} onLongPress={onLongPress} />
          ) : (
            <EntryRow entry={item} onPress={open} onLongPress={onLongPress} />
          )
        }
        ItemSeparatorComponent={viewMode === 'list' ? Separator : undefined}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
        contentContainerStyle={{ backgroundColor: colors.surface, paddingBottom: space[4] }}
        ListEmptyComponent={
          <EmptyState icon={FolderOpen} title="Nothing here yet" message="Files you add to this folder will show up here." />
        }
      />

      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        {SORTS.map((order) => (
          <Pressable
            key={order}
            onPress={() => {
              setSortOrder(order);
              setSortOpen(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.sortRow, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
          >
            <AppText tone={order === sortOrder ? 'primary' : 'default'}>{SORT_LABELS[order]}</AppText>
            {order === sortOrder && <Check size={18} color={colors.primary} />}
          </Pressable>
        ))}
      </Sheet>

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add to this folder">
        <Pressable
          onPress={() => {
            setAddOpen(false);
            setNewFolderOpen(true);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.actionRow, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
        >
          <FolderPlus size={20} color={colors.text} />
          <AppText>New folder</AppText>
        </Pressable>
        <Pressable
          onPress={() => uploadPicked(pickPhotos)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.actionRow, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
        >
          <ImageUp size={20} color={colors.text} />
          <AppText>Upload photos or videos</AppText>
        </Pressable>
        <Pressable
          onPress={() => uploadPicked(pickDocuments)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.actionRow, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
        >
          <FileUp size={20} color={colors.text} />
          <AppText>Upload files</AppText>
        </Pressable>
      </Sheet>

      <Sheet visible={newFolderOpen} onClose={() => setNewFolderOpen(false)} title="New folder">
        <View style={{ gap: space[3] }}>
          <TextField
            placeholder="Folder name"
            value={folderName}
            onChangeText={setFolderName}
            autoFocus
            autoCapitalize="sentences"
            onSubmitEditing={submitNewFolder}
            returnKeyType="done"
          />
          <Button label="Create" onPress={submitNewFolder} loading={createFolder.isPending} disabled={!folderName.trim()} />
        </View>
      </Sheet>

      <Sheet visible={!!actionEntry} onClose={() => setActionEntry(null)} title={actionEntry?.name}>
        {access?.isOwner && actionEntry?.isDir && (
          <Pressable
            onPress={() => {
              const target = actionEntry;
              setActionEntry(null);
              if (target) navigation.navigate('Share', { path: target.path, name: target.name });
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionRow, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
          >
            <UserPlus size={20} color={colors.primary} />
            <AppText tone="primary">Share</AppText>
          </Pressable>
        )}
        {actionEntry && !actionEntry.isDir && (
          <Pressable
            onPress={() => downloadEntry(actionEntry)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionRow, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
          >
            <Download size={20} color={colors.text} />
            <AppText>Download</AppText>
          </Pressable>
        )}
        {actionEntry?.canDelete && (
          <Pressable
            onPress={() => confirmDelete(actionEntry)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionRow, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
          >
            <Trash2 size={20} color={colors.danger} />
            <AppText tone="danger">Delete</AppText>
          </Pressable>
        )}
      </Sheet>
    </View>
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={[styles.separator, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 76 },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4 },
});
