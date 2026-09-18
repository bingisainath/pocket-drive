import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, RotateCw, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KIND_ICON } from '../components/FileThumb';
import { AppText, IconButton } from '../components/ui';
import { kindOf } from '../shared/lib/entries';
import { formatBytes, plural } from '../shared/lib/format';
import { useTheme } from '../theme';
import { uploads, useUploads, type UploadTask } from './store';

const percentOf = (t: UploadTask) =>
  t.size > 0 ? Math.min(100, Math.round((t.uploaded / t.size) * 100)) : t.status === 'done' ? 100 : 0;

/**
 * Floating upload panel (like the web app), shown over any screen while there are uploads. Summary
 * pill with overall %, expandable into a per-file list with progress, cancel and retry.
 */
export function UploadPanel() {
  const { colors, radii, space } = useTheme();
  const insets = useSafeAreaInsets();
  const tasks = useUploads();

  const active = tasks.filter((t) => t.status === 'queued' || t.status === 'uploading' || t.status === 'reconnecting');
  const done = tasks.filter((t) => t.status === 'done').length;
  const failed = tasks.filter((t) => t.status === 'error').length;
  const busy = active.length > 0;

  const [expanded, setExpanded] = useState(true);
  useEffect(() => setExpanded(busy || failed > 0), [busy, failed]);

  if (tasks.length === 0) return null;

  const total = active.reduce((s, t) => s + t.size, 0);
  const loaded = active.reduce((s, t) => s + t.uploaded, 0);
  const percent = total ? Math.round((loaded / total) * 100) : 0;
  const title = active.length
    ? `Uploading ${plural(active.length, 'file')} · ${percent}%`
    : failed
      ? `${done} uploaded, ${failed} failed`
      : `${plural(done, 'upload')} complete`;

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + space[4] }]} pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg }]}>
        <View style={styles.header}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : failed ? (
            <CircleAlert size={20} color={colors.danger} />
          ) : (
            <CircleCheck size={20} color={colors.success} />
          )}
          <AppText variant="body" numberOfLines={1} style={styles.title}>
            {title}
          </AppText>
          <IconButton
            icon={expanded ? ChevronDown : ChevronUp}
            accessibilityLabel={expanded ? 'Collapse uploads' : 'Expand uploads'}
            tone="muted"
            onPress={() => setExpanded((e) => !e)}
          />
          {!busy && <IconButton icon={X} accessibilityLabel="Dismiss uploads" tone="muted" onPress={() => uploads.clearFinished()} />}
        </View>

        {busy && (
          <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
            <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.primary }]} />
          </View>
        )}

        {expanded && (
          <View style={[styles.list, { borderTopColor: colors.border }]}>
            {tasks.map((t) => (
              <Row key={t.id} task={t} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function Row({ task }: { task: UploadTask }) {
  const { colors, radii } = useTheme();
  const { icon: Icon, color } = KIND_ICON[kindOf({ name: task.name, mime: null, isDir: false })];
  const pct = percentOf(task);
  const uploading = task.status === 'uploading' || task.status === 'reconnecting';
  const detail =
    task.status === 'queued'
      ? 'Waiting…'
      : task.status === 'reconnecting'
        ? `Reconnecting… ${pct}% saved`
        : task.status === 'uploading'
          ? `${pct}% · ${formatBytes(task.uploaded)} of ${formatBytes(task.size)}`
          : task.status === 'done'
            ? `${formatBytes(task.size)} · Uploaded`
            : task.status === 'error'
              ? task.error ?? 'Failed'
              : 'Cancelled';

  return (
    <View style={styles.row}>
      <Icon size={18} color={color} />
      <View style={styles.rowText}>
        <AppText variant="caption" numberOfLines={1}>
          {task.name}
        </AppText>
        {uploading && (
          <View style={[styles.rowTrack, { backgroundColor: colors.surfaceAlt, borderRadius: radii.full }]}>
            <View style={[styles.rowFill, { width: `${pct}%`, backgroundColor: colors.primary, borderRadius: radii.full }]} />
          </View>
        )}
        <AppText variant="caption" tone={task.status === 'error' ? 'danger' : 'muted'} numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      {(task.status === 'queued' || uploading) && (
        <IconButton icon={X} accessibilityLabel={`Cancel ${task.name}`} tone="muted" size={18} onPress={() => uploads.cancel(task.id)} />
      )}
      {(task.status === 'error' || task.status === 'cancelled') && (
        <IconButton icon={RotateCw} accessibilityLabel={`Retry ${task.name}`} tone="primary" size={18} onPress={() => uploads.retry(task.id)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12 },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 4, minHeight: 48 },
  title: { flex: 1, minWidth: 0, fontWeight: '500' },
  track: { height: 3 },
  fill: { height: 3 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, maxHeight: 260 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 4, paddingVertical: 8 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTrack: { height: 3, overflow: 'hidden' },
  rowFill: { height: 3 },
});
