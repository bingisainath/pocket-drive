import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { api } from '../../api/drive';
import { AppText, Button, EmptyState } from '../../components/ui';
import { formatDateTime } from '../../shared/lib/format';
import type { ActivityItem } from '../../shared/types';
import { useTheme } from '../../theme';

const PAGE = 50;

// Turn an action code into a readable verb.
const VERBS: Record<string, string> = {
  login: 'signed in',
  logout: 'signed out',
  upload: 'uploaded',
  mkdir: 'created folder',
  delete: 'deleted',
  share: 'shared',
  unshare: 'unshared',
  remove_user: 'removed a person',
  rescan: 'rescanned storage',
  login_denied: 'was denied sign-in',
  delete_account: 'deleted their account',
};

function describe(item: ActivityItem): string {
  const who = item.email ?? 'Someone';
  const verb = VERBS[item.action] ?? item.action;
  return item.path ? `${who} ${verb} ${item.path}` : `${who} ${verb}`;
}

export function ActivityScreen() {
  const { colors } = useTheme();
  const query = useInfiniteQuery({
    queryKey: ['admin', 'activity'],
    queryFn: ({ pageParam }) => api.activity(pageParam, PAGE),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.items.length === PAGE ? last.items[last.items.length - 1].id : undefined),
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (query.isPending) return <EmptyState loading />;
  if (query.isError) return <EmptyState title="Couldn’t load activity" message={(query.error as Error).message} />;

  return (
    <FlashList
      data={items}
      keyExtractor={(i) => String(i.id)}
      contentContainerStyle={{ backgroundColor: colors.surface }}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={<EmptyState icon={ScrollText} title="No activity yet" />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <AppText variant="body" numberOfLines={2}>
            {describe(item)}
          </AppText>
          <AppText variant="caption" tone="muted">
            {formatDateTime(item.at)}
          </AppText>
        </View>
      )}
      onEndReachedThreshold={0.5}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      ListFooterComponent={
        query.hasNextPage ? (
          <Button label="Load more" variant="ghost" onPress={() => query.fetchNextPage()} loading={query.isFetchingNextPage} />
        ) : null
      }
    />
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={[styles.sep, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
});
