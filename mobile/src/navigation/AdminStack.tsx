import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityScreen } from '../screens/admin/ActivityScreen';
import { PeopleScreen } from '../screens/admin/PeopleScreen';
import { useTheme } from '../theme';
import type { AdminStackParamList } from './types';

const Stack = createNativeStackNavigator<AdminStackParamList>();

/** The owner-only Admin tab: People & access, with the Activity log one level in. */
export function AdminStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.primary,
      }}
    >
      <Stack.Screen name="People" component={PeopleScreen} options={{ title: 'People & access' }} />
      <Stack.Screen name="Activity" component={ActivityScreen} options={{ title: 'Activity' }} />
    </Stack.Navigator>
  );
}
