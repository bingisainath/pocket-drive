import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Trash2, Users } from 'lucide-react-native';
import { useLayoutEffect } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { api } from '../../api/drive';
import { AppText, EmptyState, IconButton, ListItem } from '../../components/ui';
import type { AdminStackParamList } from '../../navigation/types';
import { formatDate, plural } from '../../shared/lib/format';
import type { Person } from '../../shared/types';
import { useTheme } from '../../theme';

type Props = NativeStackScreenProps<AdminStackParamList, 'People'>;

export function PeopleScreen({ navigation }: Props) {
  const { colors, radii } = useTheme();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.users() });

  const removeUser = useMutation({
    mutationFn: (id: number) => api.removeUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
    onError: (err) => Alert.alert('Couldn’t remove', (err as Error).message),
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components -- header render prop
      headerRight: () => (
        <IconButton icon={History} accessibilityLabel="Activity log" tone="primary" onPress={() => navigation.navigate('Activity')} />
      ),
    });
  }, [navigation]);

  const confirmRemove = (person: Person) => {
    Alert.alert(
      `Remove ${person.name ?? person.email}?`,
      'They lose access to every shared folder and are signed out. Files they uploaded stay on your drive.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeUser.mutate(person.id) },
      ],
    );
  };

  if (query.isPending) return <EmptyState loading />;
  if (query.isError) return <EmptyState title="Couldn’t load people" message={(query.error as Error).message} />;

  return (
    <FlashList
      data={query.data?.users ?? []}
      keyExtractor={(u) => String(u.id)}
      contentContainerStyle={{ backgroundColor: colors.surface }}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={<EmptyState icon={Users} title="No one yet" message="Share a folder to invite someone." />}
      renderItem={({ item }) => (
        <ListItem
          title={item.name ?? item.email}
          subtitle={
            item.isOwner
              ? 'Owner'
              : `${plural(item.shares.length, 'folder')}${item.lastLoginAt ? ` · last seen ${formatDate(item.lastLoginAt)}` : ' · never signed in'}`
          }
          leading={
            <View style={[styles.avatar, { backgroundColor: colors.surfaceAlt, borderRadius: radii.full }]}>
              <AppText variant="label">{(item.name ?? item.email).charAt(0).toUpperCase()}</AppText>
            </View>
          }
          trailing={
            item.isOwner ? undefined : (
              <IconButton icon={Trash2} accessibilityLabel={`Remove ${item.email}`} tone="danger" onPress={() => confirmRemove(item)} />
            )
          }
        />
      )}
    />
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={[styles.sep, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 72 },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
