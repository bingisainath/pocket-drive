import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { AppText, Button, TextField } from '../components/ui';
import { useTheme } from '../theme';

export function LoginScreen() {
  const { colors, space } = useTheme();
  const { state, signIn } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? (state.status === 'signedOut' ? state.error : undefined);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { padding: space[6] }]}>
        <AppText variant="display" style={styles.centered}>
          Pocket Drive
        </AppText>
        <AppText variant="body" tone="muted" style={styles.centered}>
          Sign in to your drive
        </AppText>

        <View style={[styles.form, { marginTop: space[8], gap: space[3] }]}>
          <TextField
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder="Owner password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            returnKeyType="go"
            error={shownError ?? undefined}
          />
          <Button label="Sign in" onPress={submit} loading={busy} disabled={!password} />
        </View>

        {/* TODO(Phase 3): "Continue with Google" — native Google Sign-In + backend token endpoint. */}
        <AppText variant="caption" tone="muted" style={[styles.centered, { marginTop: space[6] }]}>
          Google sign-in is coming to the app soon.
        </AppText>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, justifyContent: 'center' },
  centered: { textAlign: 'center' },
  form: {},
});
