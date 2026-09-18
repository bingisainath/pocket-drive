/**
 * @format
 */

import 'react-native-gesture-handler'; // must be imported before anything else
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
