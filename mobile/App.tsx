import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { persistOptions, queryClient } from './src/lib/query';
import { RootNavigator } from './src/navigation/RootNavigator';
import { UploadPanel } from './src/uploads/UploadPanel';

export default function App() {
  const dark = useColorScheme() === 'dark';
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <AuthProvider>
            <View style={styles.root}>
              <NavigationContainer theme={dark ? DarkTheme : DefaultTheme}>
                <RootNavigator />
              </NavigationContainer>
              <UploadPanel />
            </View>
          </AuthProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
