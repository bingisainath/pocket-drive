import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { AppText } from './AppText';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * A bottom sheet built on the platform Modal — no third-party sheet library. Tapping the scrim or the
 * Android back button dismisses it. Lifts above the keyboard so text inputs stay visible, and respects
 * the bottom safe-area inset.
 */
export function Sheet({ visible, onClose, title, children }: Props) {
  const { colors, radii, space } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.root}>
        <Pressable style={[styles.scrim, { backgroundColor: colors.overlay }]} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              paddingBottom: insets.bottom + space[4],
              paddingHorizontal: space[4],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {title && (
            <AppText variant="subtitle" style={styles.title}>
              {title}
            </AppText>
          )}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { paddingTop: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  title: { marginBottom: 12 },
});
