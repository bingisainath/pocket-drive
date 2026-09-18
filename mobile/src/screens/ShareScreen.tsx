import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react-native';
import { useLayoutEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '../api/drive';
import { AppText, Button, EmptyState, IconButton, TextField } from '../components/ui';
import type { FilesStackParamList } from '../navigation/types';
import type { Role, Share } from '../shared/types';
import { useTheme } from '../theme';

type Props = NativeStackScreenProps<FilesStackParamList, 'Share'>;

const ROLES: Role[] = ['viewer', 'contributor', 'editor'];
const ROLE_LABEL: Record<Role, string> = { viewer: 'Viewer', contributor: 'Contributor', editor: 'Editor' };

export function ShareScreen({ navigation, route }: Props) {
  const { path, name } = route.params;
  const { colors, space, radii } = useTheme();
  const qc = useQueryClient();
  const key = ['admin', 'shares', path];

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');

  useLayoutEffect(() => navigation.setOptions({ title: `Share “${name}”` }), [navigation, name]);

  const query = useQuery({ queryKey: key, queryFn: () => api.shares(path) });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: (vars: { email: string; role: Role }) => api.addShare(path, vars.email, vars.role),
    onSuccess: () => {
      setEmail('');
      invalidate();
    },
    onError: (err) => Alert.alert('Couldn’t share', (err as Error).message),
  });
  const removeShare = useMutation({ mutationFn: (id: number) => api.removeShare(id), onSuccess: invalidate });

  const submit = () => {
    const value = email.trim();
    if (value) add.mutate({ email: value, role });
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: space[4], gap: space[4] }}>
      <View style={{ gap: space[2] }}>
        <TextField
          label="Invite by email"
          placeholder="name@example.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <View style={styles.roleRow}>
          {ROLES.map((r) => {
            const chipStyle = [styles.chip, { borderColor: colors.border, borderRadius: radii.full, backgroundColor: r === role ? colors.primary : colors.surface }];
            return (
              <Pressable key={r} onPress={() => setRole(r)} accessibilityRole="button" style={chipStyle}>
                <AppText variant="caption" tone={r === role ? 'onPrimary' : 'muted'}>
                  {ROLE_LABEL[r]}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <Button label="Share" onPress={submit} loading={add.isPending} disabled={!email.trim()} />
      </View>

      {query.isPending ? (
        <EmptyState loading />
      ) : (
        <>
          <Section title="Shared with">
            {query.data && query.data.direct.length > 0 ? (
              query.data.direct.map((s) => (
                <ShareRow key={s.id} share={s} onRemove={() => removeShare.mutate(s.id)} onRole={(r) => add.mutate({ email: s.user.email, role: r })} />
              ))
            ) : (
              <AppText variant="caption" tone="muted">
                Not shared with anyone yet.
              </AppText>
            )}
          </Section>

          {query.data && query.data.inherited.length > 0 && (
            <Section title="Also has access (from a parent folder)">
              {query.data.inherited.map((s) => (
                <View key={s.id} style={styles.inherited}>
                  <AppText variant="body" numberOfLines={1}>
                    {s.user.name ?? s.user.email}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {ROLE_LABEL[s.role]} · via {s.path || 'My Drive'}
                  </AppText>
                </View>
              ))}
            </Section>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <AppText variant="label" tone="muted">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function ShareRow({ share, onRemove, onRole }: { share: Share; onRemove: () => void; onRole: (role: Role) => void }) {
  const { colors, radii, space } = useTheme();
  const initial = (share.user.name ?? share.user.email).charAt(0).toUpperCase();
  const nextRole = () => onRole(ROLES[(ROLES.indexOf(share.role) + 1) % ROLES.length]);
  return (
    <View style={[styles.row, { gap: space[3] }]}>
      <View style={[styles.avatar, { backgroundColor: colors.surfaceAlt, borderRadius: radii.full }]}>
        <AppText variant="label">{initial}</AppText>
      </View>
      <View style={styles.rowText}>
        <AppText variant="body" numberOfLines={1}>
          {share.user.name ?? share.user.email}
        </AppText>
        <Pressable onPress={nextRole} accessibilityRole="button" accessibilityLabel={`Change role, currently ${share.role}`}>
          <AppText variant="caption" tone="primary">
            {ROLE_LABEL[share.role]} ▾
          </AppText>
        </Pressable>
      </View>
      <IconButton icon={X} accessibilityLabel={`Remove ${share.user.email}`} tone="danger" onPress={onRemove} />
    </View>
  );
}

const styles = StyleSheet.create({
  roleRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inherited: { paddingVertical: 6, gap: 2 },
});
