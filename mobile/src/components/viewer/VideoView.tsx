import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Video from 'react-native-video';
import { authHeaders, urls } from '../../api/drive';
import { AppText } from '../ui';
import type { Entry } from '../../shared/types';

/**
 * Plays a video: the adaptive HLS stream (/stream/master.m3u8) once the server has built it,
 * otherwise the original file (Android decodes HEVC natively). Shows a note while it's still processing.
 */
export function VideoView({ entry }: { entry: Entry }) {
  const [uri, setUri] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(urls.stream(entry), { headers: authHeaders() });
        if (cancelled) return;
        if (res.ok) {
          setUri(urls.stream(entry));
        } else {
          const body = await res.json().catch(() => ({}));
          if (body.status === 'processing') setNote('A streaming version is being prepared — playing the original for now.');
          setUri(urls.raw(entry));
        }
      } catch {
        if (!cancelled) setUri(urls.raw(entry));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (!uri) return <ActivityIndicator style={styles.container} size="large" color="#fff" />;

  return (
    <View style={styles.container}>
      <Video
        source={{ uri, headers: authHeaders() }}
        style={StyleSheet.absoluteFill}
        controls
        resizeMode="contain"
        paused={false}
      />
      {note && (
        <View style={styles.note}>
          <AppText variant="caption" tone="onPrimary">
            {note}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  note: { position: 'absolute', top: 12, left: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 8 },
});
