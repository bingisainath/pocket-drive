import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Entry } from '../shared/types';

/** Native stack inside the Files tab: drill down through folders, search, and the file viewer. */
export type FilesStackParamList = {
  /** `path` is relative to the drive root ('' = My Drive, or "Shared with me" for members). */
  Folder: { path: string; title: string };
  Search: undefined;
  Viewer: { entry: Entry };
};

/** The bottom tabs. Admin is only registered for the owner. */
export type MainTabsParamList = {
  Files: NavigatorScreenParams<FilesStackParamList> | undefined;
  Uploads: undefined;
  Settings: undefined;
  Admin: undefined;
};

/** Root: swap between the sign-in screen and the signed-in tabs. */
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};
