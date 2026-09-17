import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { SearchX } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { api } from '../api/drive';
import { EntryRow } from '../components/EntryRow';
import { EmptyState, TextField } from '../components/ui';
import { useDebounce } from '../hooks/useDebounce';
import type { FilesStackParamList } from '../navigation/types';
import { formatBytes } from '../shared/lib/format';
import type { Entry } from '../shared/types';
import { useTheme } from '../theme';

type Props = NativeStackScreenProps<FilesStackParamList, 'Search'>;

export function SearchScreen({ navigation }: Props) {
  const { colors, space } = useTheme();
  const [text, setText] = useState('');
  const q = useDebounce(text.trim(), 300);

  const query = useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q.length > 0,
  });
  const entries = query.data?.entries ?? [];

  const open = (entry: Entry) => {
    if (entry.isDir) navigation.push('Folder', { path: entry.path, title: entry.name });
    // TODO(viewer slice): open files from search results in the viewer.
    else Alert.alert(entry.name, `${formatBytes(entry.size)}\n\nOpening files arrives with the viewer.`);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={{ padding: space[4] }}>
        <TextField placeholder="Search your drive" value={text} onChangeText={setText} autoFocus autoCorrect={false} returnKeyType="search" />
      </View>
      {q.length === 0 ? (
        <EmptyState message="Type to search across everything you can see." />
      ) : query.isPending ? (
        <EmptyState loading />
      ) : entries.length === 0 ? (
        <EmptyState icon={SearchX} title="No matches" message={`Nothing found for “${q}”.`} />
      ) : (
        <FlashList
          data={entries}
          keyExtractor={(e) => String(e.id)}
          renderItem={({ item }) => <EntryRow entry={item} onPress={open} />}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ backgroundColor: colors.surface }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
