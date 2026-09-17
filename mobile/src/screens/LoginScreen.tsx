import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { useColors } from '../theme';

export function LoginScreen() {
  const colors = useColors();
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <Text style={[styles.title, { color: colors.text }]}>Pocket Drive</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Sign in to your drive</Text>

        <View style={styles.form}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder="Owner password"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            returnKeyType="go"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          />
          {shownError && <Text style={[styles.error, { color: colors.danger }]}>{shownError}</Text>}
          <Pressable
            onPress={submit}
            disabled={!password || busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.primary, opacity: !password || busy ? 0.5 : pressed ? 0.8 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryText }]}>Sign in</Text>
            )}
          </Pressable>
        </View>

        {/* TODO: "Continue with Google" needs native Google Sign-In plus a backend endpoint that
            verifies the Google ID token and issues a session (see mobile/README.md → Next steps). */}
        <Text style={[styles.note, { color: colors.muted }]}>Google sign-in is coming to the app soon.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', marginTop: 6 },
  form: { marginTop: 32, gap: 12 },
  input: { height: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  error: { fontSize: 14 },
  button: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  note: { fontSize: 13, textAlign: 'center', marginTop: 24 },
});
