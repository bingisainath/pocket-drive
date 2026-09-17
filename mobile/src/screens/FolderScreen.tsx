import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { ArrowUpDown, Check, FolderOpen, LayoutGrid, List, Search } from 'lucide-react-native';
import { useCallback, useLayoutEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Breadcrumbs, type Crumb } from '../components/Breadcrumbs';
import { EntryCell } from '../components/EntryCell';
import { EntryRow } from '../components/EntryRow';
import { OfflineBanner } from '../components/OfflineBanner';
import { AppText, EmptyState, IconButton, Sheet } from '../components/ui';
import { useFolder } from '../hooks/useFolder';
import { useSortOrder, useViewMode } from '../lib/prefs';
import type { FilesStackParamList } from '../navigation/types';
import { SORT_LABELS, SORTS } from '../shared/lib/entries';
import { formatBytes } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';

type Props = NativeStackScreenProps<FilesStackParamList, 'Folder'>;

const COLUMNS = 3;

export function FolderScreen({ navigation, route }: Props) {
  const { path } = route.params;
  const { colors, space } = useTheme();
  const { width } = useWindowDimensions();
  const [viewMode, setViewMode] = useViewMode();
  const [sortOrder, setSortOrder] = useSortOrder();
  const [sortOpen, setSortOpen] = useState(false);
  const { entries, loading, refreshing, error, refresh, access } = useFolder(path, sortOrder);
  const tile = Math.floor(width / COLUMNS);

  const open = useCallback(
    (entry: Entry) => {
      if (entry.isDir) {
        navigation.push('Folder', { path: entry.path, title: entry.name });
        return;
      }
      // TODO(viewer slice): photo/video/PDF/text viewer.
      Alert.alert(entry.name, `${formatBytes(entry.size)}\n\nThe file viewer is the next thing to build.`);
    },
    [navigation],
  );

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
        </View>
      ),
    });
  }, [navigation, viewMode, setViewMode]);

  if (loading) return <EmptyState loading />;
  if (error && entries.length === 0) {
    return <EmptyState title="Couldn’t load this folder" message={error} actionLabel="Try again" onAction={refresh} />;
  }

  return (
    <View style={styles.screen}>
      <OfflineBanner />
      <Breadcrumbs path={path} isOwner={access?.isOwner ?? false} accessRoot={access?.accessRoot ?? null} onNavigate={goToCrumb} />
      <FlashList
        key={viewMode} // a numColumns change needs a fresh list instance
        data={entries}
        numColumns={viewMode === 'grid' ? COLUMNS : 1}
        keyExtractor={(entry) => String(entry.id)}
        renderItem={({ item }) =>
          viewMode === 'grid' ? <EntryCell entry={item} tile={tile} onPress={open} /> : <EntryRow entry={item} onPress={open} />
        }
        ItemSeparatorComponent={viewMode === 'list' ? Separator : undefined}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
        contentContainerStyle={{ backgroundColor: colors.surface, paddingBottom: space[8] }}
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
});
