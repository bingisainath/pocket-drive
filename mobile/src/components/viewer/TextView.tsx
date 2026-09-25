import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { API_BASE_URL } from '../../config';
import { authHeaders } from '../../api/drive';
import { EmptyState } from '../ui';
import { useTheme } from '../../theme';
import type { Entry } from '../../shared/types';

/** Shows a small text/code file inline in a monospace scroll view. */
export function TextView({ entry }: { entry: Entry }) {
  const { colors, space } = useTheme();
  const [state, setState] = useState<{ text?: string; error?: string }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/files/${entry.id}/raw`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`Couldn’t load the file (HTTP ${res.status})`);
        const text = await res.text();
        if (!cancelled) setState({ text });
      } catch (err) {
        if (!cancelled) setState({ error: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  if (state.error) return <EmptyState title="Couldn’t open this file" message={state.error} />;
  if (state.text === undefined) return <EmptyState loading />;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4] }}
      horizontal={false}
    >
      <Text selectable style={[styles.mono, { color: colors.text }]}>
        {state.text}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'monospace', fontSize: 13, lineHeight: 18 },
});
