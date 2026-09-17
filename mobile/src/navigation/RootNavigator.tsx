import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { StateView } from '../components/StateView';
import { FolderScreen } from '../screens/FolderScreen';
import { LoginScreen } from '../screens/LoginScreen';

export type RootStackParamList = {
  Login: undefined;
  /** `path` is relative to the drive root ('' = My Drive, or "Shared with me" for friends). */
  Folder: { path: string; title: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { state } = useAuth();

  if (state.status === 'loading') return <StateView loading />;

  return (
    <Stack.Navigator>
      {state.status === 'signedIn' ? (
        <Stack.Screen
          name="Folder"
          component={FolderScreen}
          initialParams={{ path: '', title: state.user.isOwner ? 'My Drive' : 'Shared with me' }}
          options={({ route }) => ({ title: route.params.title })}
        />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}
