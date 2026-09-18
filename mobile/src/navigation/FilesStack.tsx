import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { FolderScreen } from '../screens/FolderScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ShareScreen } from '../screens/ShareScreen';
import { ViewerScreen } from '../screens/ViewerScreen';
import { useTheme } from '../theme';
import type { FilesStackParamList } from './types';

const Stack = createNativeStackNavigator<FilesStackParamList>();

/** The Files tab: a native stack you drill down through, folder by folder. */
export function FilesStack() {
  const { colors } = useTheme();
  const { state } = useAuth();
  const isOwner = state.status === 'signedIn' && state.user.isOwner;

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.primary,
      }}
    >
      <Stack.Screen
        name="Folder"
        component={FolderScreen}
        initialParams={{ path: '', title: isOwner ? 'My Drive' : 'Shared with me' }}
        options={({ route }) => ({ title: route.params.title })}
      />
      <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
      <Stack.Screen name="Viewer" component={ViewerScreen} />
      <Stack.Screen name="Share" component={ShareScreen} />
    </Stack.Navigator>
  );
}
