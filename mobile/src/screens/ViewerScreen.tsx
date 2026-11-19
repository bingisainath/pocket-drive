import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Download, FileQuestion } from 'lucide-react-native';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, ToastAndroid, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { urls } from '../api/drive';
import { AppText, EmptyState, IconButton } from '../components/ui';
import { MediaPager } from '../components/viewer/MediaPager';
import { TextView } from '../components/viewer/TextView';
import type { FilesStackParamList } from '../navigation/types';
import { previewKind } from '../shared/lib/entries';
import type { Entry } from '../shared/types';
import { downloadFile } from '../uploads/native';

type Props = NativeStackScreenProps<FilesStackParamList, 'Viewer'>;

const isMedia = (e: Entry) => {
  const kind = previewKind(e);
  return kind === 'image' || kind === 'video' || kind === 'audio';
};

export function ViewerScreen({ navigation, route }: Props) {
  const { entry, siblings } = route.params;
  const media = isMedia(entry);

  // The photos and videos of the folder (or search) it was opened from, in the same order, so you
  // can swipe through them. Falls back to just this file.
  const items = useMemo(() => {
    if (!media) return [entry];
    const list = (siblings ?? []).filter(isMedia);
    return list.some((e) => e.id === entry.id) ? list : [entry];
  }, [entry, siblings, media]);
  const initialIndex = Math.max(0, items.findIndex((e) => e.id === entry.id));

  useLayoutEffect(() => {
    if (media) {
      // Full-screen and dark: the pager draws its own top bar so it can fade with a tap.
      navigation.setOptions({ headerShown: false, statusBarStyle: 'light', animation: 'fade' });
    } else {
      navigation.setOptions({ title: entry.name });
    }
  }, [navigation, entry.name, media]);

  if (media) return <MediaViewer items={items} initialIndex={initialIndex} onClose={navigation.goBack} />;

  if (previewKind(entry) === 'text') return <TextView entry={entry} />;
  // PDF and other types: save it and open it with another app.
  return (
    <EmptyState
      icon={FileQuestion}
      title="Preview not available"
      message="This file type can’t be previewed in the app. Download it to open it with another app."
      actionLabel="Download"
      onAction={() => download(entry)}
    />
  );
}

function download(entry: Entry) {
  downloadFile(urls.download(entry), entry.name, entry.mime)
    .then(() => ToastAndroid.show(`Downloading “${entry.name}” to Downloads`, ToastAndroid.SHORT))
    .catch((err) => Alert.alert('Download failed', (err as Error).message));
}

function MediaViewer({ items, initialIndex, onClose }: { items: Entry[]; initialIndex: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [chrome, setChrome] = useState(true);
  const current = items[index] ?? items[0];

  const toggleChrome = useCallback(() => setChrome((c) => !c), []);

  return (
    <View style={styles.root}>
      <MediaPager items={items} initialIndex={initialIndex} onIndexChange={setIndex} onTap={toggleChrome} onDismiss={onClose} />
      {chrome && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          style={[styles.topBar, { paddingTop: insets.top }]}
          pointerEvents="box-none"
        >
          <IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={onClose} color="#fff" />
          <View style={styles.titleBox}>
            <AppText variant="body" numberOfLines={1} style={styles.title}>
              {current.name}
            </AppText>
            {items.length > 1 && (
              <AppText variant="caption" style={styles.counter}>
                {index + 1} of {items.length}
              </AppText>
            )}
          </View>
          <IconButton icon={Download} accessibilityLabel={`Download ${current.name}`} onPress={() => download(current)} color="#fff" />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  titleBox: { flex: 1, minWidth: 0, paddingHorizontal: 4 },
  title: { color: '#fff', fontWeight: '500' },
  counter: { color: '#ffffffb3' },
});
