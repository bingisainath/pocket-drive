import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';
import { StatusBar, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { AppLockGate } from './src/lock/AppLockGate';
import { persistOptions, queryClient } from './src/lib/query';
import { navigationRef } from './src/navigation/ref';
import { RootNavigator } from './src/navigation/RootNavigator';
import { configurePush } from './src/push/push';
import { UploadPanel } from './src/uploads/UploadPanel';

export default function App() {
  const dark = useColorScheme() === 'dark';

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    configurePush()
      .then((unsub) => {
        cleanup = unsub;
      })
      .catch(() => {}); // push just won't work (e.g. no Play services); the app still runs
    return () => cleanup?.();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <AuthProvider>
            <AppLockGate>
              <NavigationContainer ref={navigationRef} theme={dark ? DarkTheme : DefaultTheme}>
                <RootNavigator />
              </NavigationContainer>
              <UploadPanel />
            </AppLockGate>
          </AuthProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
