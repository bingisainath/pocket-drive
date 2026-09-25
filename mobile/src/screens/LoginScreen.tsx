import { GoogleSignIn, GoogleSignInButton, GoogleSignInErrorCode, isGoogleSignInError } from '@thoughtbot/react-native-social-auth';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { AppText, Button, TextField } from '../components/ui';
import { GOOGLE_WEB_CLIENT_ID } from '../config';
import { useTheme } from '../theme';

const googleEnabled = GOOGLE_WEB_CLIENT_ID.length > 0;
if (googleEnabled) GoogleSignIn.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

export function LoginScreen() {
  const { colors, dark, space } = useTheme();
  const { state, signIn, signInWithGoogle } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? (state.status === 'signedOut' ? state.error : undefined);

  useEffect(() => {
    if (googleEnabled) GoogleSignIn.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  }, []);

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

  const onGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const credential = await GoogleSignIn.signIn();
      await signInWithGoogle(credential.idToken); // AuthContext saves the token and flips to signedIn
    } catch (err) {
      if (!(isGoogleSignInError(err) && err.code === GoogleSignInErrorCode.SIGN_IN_CANCELLED)) {
        setError((err as Error).message);
      }
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

        {googleEnabled && (
          <View style={[styles.google, { marginTop: space[6], gap: space[3] }]}>
            <AppText variant="caption" tone="muted" style={styles.centered}>
              or
            </AppText>
            <GoogleSignInButton theme={dark ? 'dark' : 'light'} text="continue" onPress={onGoogle} disabled={busy} style={styles.center} />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, justifyContent: 'center' },
  centered: { textAlign: 'center' },
  center: { alignSelf: 'center' },
  form: {},
  google: {},
});
