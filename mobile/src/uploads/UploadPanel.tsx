import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, CloudOff, FolderUp, RotateCw, Wifi, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KIND_ICON } from '../components/FileThumb';
import { AppText, IconButton } from '../components/ui';
import { navigateToFolder, useCurrentRouteName } from '../navigation/ref';
import { kindOf } from '../shared/lib/entries';
import { formatBytes, plural } from '../shared/lib/format';
import { useTheme } from '../theme';
import { setWifiOnly, useUploadBlocker, type UploadBlocker } from './network';
import { uploads, useUploads, type UploadTask } from './store';

/** Default react-navigation bottom tab bar height; the panel floats just above it. */
const TAB_BAR_HEIGHT = 49;
/** A finished batch with no failures clears itself after this long. */
const AUTO_DISMISS_MS = 4000;
/** Screens where the panel would cover the content (full-screen media). */
const HIDDEN_ON = new Set(['Viewer']);

const percentOf = (t: UploadTask) =>
  t.status === 'done' ? 100 : t.size > 0 ? Math.min(100, Math.floor((t.uploaded / t.size) * 100)) : 0;

/** A drive folder path as people read it: '' is My Drive, nested folders use › separators. */
const folderLabel = (folder: string) => (folder ? folder.split('/').join(' › ') : 'My Drive');
const folderName = (folder: string) => (folder ? folder.slice(folder.lastIndexOf('/') + 1) : 'My Drive');

const WAITING: Record<Exclude<UploadBlocker, null>, string> = {
  offline: 'Waiting for a connection',
  wifi: 'Waiting for Wi-Fi',
};

/**
 * Floating upload panel (like the web app), shown over any screen while there are uploads. A compact
 * pill with overall progress that expands into a per-file list with cancel and retry. It says why
 * uploads are waiting (offline, or Wi-Fi only on mobile data) instead of looking stuck.
 */
export function UploadPanel() {
  const { colors, radii, space } = useTheme();
  const insets = useSafeAreaInsets();
  const tasks = useUploads();
  const blocker = useUploadBlocker();
  const route = useCurrentRouteName();

  const active = tasks.filter((t) => t.status === 'queued' || t.status === 'uploading' || t.status === 'reconnecting');
  const done = tasks.filter((t) => t.status === 'done').length;
  const failed = tasks.filter((t) => t.status === 'error').length;
  const busy = active.length > 0;
  const sending = active.some((t) => t.status === 'uploading');
  const waiting = busy && !sending && blocker ? blocker : null;

  // Compact by default so it doesn't cover the list; open by itself only when something failed.
  const [expanded, setExpanded] = useState(false);
  const prevFailed = useRef(0);
  useEffect(() => {
    if (failed > prevFailed.current) setExpanded(true);
    prevFailed.current = failed;
  }, [failed]);

  useEffect(() => {
    if (busy || failed || done === 0) return;
    const timer = setTimeout(() => uploads.clearFinished(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [busy, failed, done]);

  if (tasks.length === 0 || (route && HIDDEN_ON.has(route))) return null;

  // Overall progress across the whole batch (finished files count in full), so the percentage only
  // moves forward as files complete instead of jumping when one leaves the active list.
  const batch = tasks.filter((t) => t.status !== 'cancelled' && t.status !== 'error');
  const total = batch.reduce((s, t) => s + t.size, 0);
  const loaded = batch.reduce((s, t) => s + (t.status === 'done' ? t.size : Math.min(t.uploaded, t.size)), 0);
  const percent = total ? Math.min(100, Math.floor((loaded / total) * 100)) : 0;

  // Where these files are going: one folder, or how many.
  const folders = [...new Set((busy ? active : tasks).map((t) => t.folder))];
  const destination = folders.length === 1 ? folderLabel(folders[0]) : `${folders.length} folders`;
  const title = waiting
    ? `${WAITING[waiting]} · ${plural(active.length, 'file')}`
    : busy
      ? `Uploading ${plural(active.length, 'file')} · ${percent}%`
      : failed
        ? `${done} uploaded, ${failed} failed`
        : `${plural(done, 'upload')} complete`;

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + space[3] }]} pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg }]}>
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${expanded ? 'Collapse' : 'Expand'} uploads`}
          style={styles.header}
        >
          {waiting === 'offline' ? (
            <CloudOff size={20} color={colors.muted} />
          ) : waiting === 'wifi' ? (
            <Wifi size={20} color={colors.muted} />
          ) : busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : failed ? (
            <CircleAlert size={20} color={colors.danger} />
          ) : (
            <CircleCheck size={20} color={colors.success} />
          )}
          <View style={styles.titleBox}>
            <AppText variant="body" numberOfLines={1} style={styles.title}>
              {title}
            </AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {busy ? 'To' : 'In'} {destination}
            </AppText>
          </View>
          {expanded ? <ChevronDown size={20} color={colors.muted} /> : <ChevronUp size={20} color={colors.muted} />}
          {!busy ? (
            <IconButton icon={X} accessibilityLabel="Dismiss uploads" tone="muted" onPress={() => uploads.clearFinished()} />
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </Pressable>

        {waiting === 'wifi' && (
          <Pressable
            onPress={() => setWifiOnly(false)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, { borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
          >
            <AppText variant="caption" tone="primary" style={styles.actionText}>
              Upload using mobile data
            </AppText>
          </Pressable>
        )}

        {expanded && folders.length === 1 && (
          <Pressable
            onPress={() => navigateToFolder(folders[0], folderName(folders[0]))}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, styles.actionRow, { borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
          >
            <FolderUp size={16} color={colors.primary} />
            <AppText variant="caption" tone="primary" style={styles.actionText}>
              Open {folderName(folders[0])}
            </AppText>
          </Pressable>
        )}

        {busy && !waiting && (
          <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
            <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.primary }]} />
          </View>
        )}

        {expanded && (
          <ScrollView style={[styles.list, { borderTopColor: colors.border }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {tasks.map((t) => (
              <Row key={t.id} task={t} blocker={blocker} showFolder={folders.length > 1} />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function Row({ task, blocker, showFolder }: { task: UploadTask; blocker: UploadBlocker; showFolder: boolean }) {
  const { colors, radii } = useTheme();
  const { icon: Icon, color } = KIND_ICON[kindOf({ name: task.name, mime: null, isDir: false })];
  const pct = percentOf(task);
  const uploading = task.status === 'uploading' || task.status === 'reconnecting';
  const detail =
    task.status === 'queued'
      ? `${blocker ? WAITING[blocker] : 'Waiting'}…${pct > 0 ? ` ${pct}% saved` : ''}`
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
          {showFolder ? `${detail} · ${folderName(task.folder)}` : detail}
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
  headerSpacer: { width: 8 },
  titleBox: { flex: 1, minWidth: 0, paddingVertical: 6 },
  title: { fontWeight: '500' },
  action: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10 },
  actionText: { fontWeight: '600' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 3 },
  fill: { height: 3 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, maxHeight: 260 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 4, paddingVertical: 8 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTrack: { height: 3, overflow: 'hidden' },
  rowFill: { height: 3 },
});
