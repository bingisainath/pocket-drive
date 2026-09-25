import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Folder, Settings as SettingsIcon, Shield, type LucideIcon } from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useTheme } from '../theme';
import { AdminStack } from './AdminStack';
import { FilesStack } from './FilesStack';
import type { MainTabsParamList } from './types';

const Tab = createBottomTabNavigator<MainTabsParamList>();

const tabIcon =
  (Icon: LucideIcon) =>
  ({ color, size }: { color: string; size: number }) =>
    <Icon color={color} size={size} />;

/** Bottom tabs: Files, Settings — plus an owner-only Admin tab. Uploads show in a floating panel. */
export function MainTabs() {
  const { colors } = useTheme();
  const { state } = useAuth();
  const isOwner = state.status === 'signedIn' && state.user.isOwner;

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.text,
      }}
    >
      <Tab.Screen name="Files" component={FilesStack} options={{ headerShown: false, tabBarIcon: tabIcon(Folder) }} />
      {isOwner && <Tab.Screen name="Admin" component={AdminStack} options={{ headerShown: false, tabBarIcon: tabIcon(Shield) }} />}
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: tabIcon(SettingsIcon) }} />
    </Tab.Navigator>
  );
}
