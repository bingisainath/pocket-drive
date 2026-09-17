import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { EntryRow } from '../components/EntryRow';
import { StateView } from '../components/StateView';
import { useFolder } from '../hooks/useFolder';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { formatBytes } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Folder'>;

export function FolderScreen({ navigation, route }: Props) {
  const { path } = route.params;
  const colors = useColors();
  const { entries, loading, refreshing, error, refresh } = useFolder(path);

  // Sign out lives on the top-level screen's header for now (a settings screen can take it over later).
  useLayoutEffect(() => {
    if (path === '') navigation.setOptions({ headerRight: SignOutButton });
  }, [navigation, path]);

  const open = useCallback(
    (entry: Entry) => {
      if (entry.isDir) {
        navigation.push('Folder', { path: entry.path, title: entry.name });
        return;
      }
      // TODO: file viewer (photo previews, HLS video, PDF, text) — see mobile/README.md → Next steps.
      Alert.alert(entry.name, `${formatBytes(entry.size)}\n\nThe file viewer is the next thing to build.`);
    },
    [navigation],
  );

  if (loading) return <StateView loading />;
  if (error && entries.length === 0) {
    return <StateView title="Couldn’t load this folder" message={error} actionLabel="Try again" onAction={refresh} />;
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => String(entry.id)}
      renderItem={({ item }) => <EntryRow entry={item} onPress={open} />}
      ItemSeparatorComponent={Separator}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} />}
      contentContainerStyle={entries.length === 0 ? styles.emptyContainer : undefined}
      ListEmptyComponent={
        <StateView title="Nothing here yet" message="Files you upload to this folder will show up here." />
      }
      style={{ backgroundColor: colors.surface }}
    />
  );
}

function SignOutButton() {
  const colors = useColors();
  const { signOut } = useAuth();
  return (
    <Pressable onPress={signOut} accessibilityRole="button" hitSlop={8}>
      <Text style={[styles.headerButton, { color: colors.primary }]}>Sign out</Text>
    </Pressable>
  );
}

function Separator() {
  const colors = useColors();
  return <View style={[styles.separator, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  headerButton: { fontSize: 16, fontWeight: '500' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 76 },
  emptyContainer: { flexGrow: 1 },
});
