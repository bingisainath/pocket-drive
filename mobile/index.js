/**
 * @format
 */

import 'react-native-gesture-handler'; // must be imported before anything else
import { getApp } from '@react-native-firebase/app';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// FCM shows the backend's notification payloads itself when the app is backgrounded/killed; taps
// are handled on next launch (getInitialNotification / onNotificationOpenedApp), so these are no-ops
// registered only so Firebase/Notifee don't warn about a missing background handler.
setBackgroundMessageHandler(getMessaging(getApp()), async () => {});
notifee.onBackgroundEvent(async () => {});

AppRegistry.registerComponent(appName, () => App);
