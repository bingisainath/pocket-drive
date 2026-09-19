import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/ui';
import { LoginScreen } from '../screens/LoginScreen';
import { SharedFilesWatcher } from '../uploads/SharedFilesWatcher';
import { MainTabs } from './MainTabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Swaps between the sign-in screen and the signed-in tabs based on auth state. */
export function RootNavigator() {
  const { state } = useAuth();

  if (state.status === 'loading') return <EmptyState loading />;

  const signedIn = state.status === 'signedIn';

  return (
    <>
      {signedIn && <SharedFilesWatcher />}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {signedIn ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </>
  );
}
