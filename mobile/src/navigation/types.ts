import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Entry } from '../shared/types';

/** Native stack inside the Files tab: drill down through folders, search, viewer, and (owner) share. */
export type FilesStackParamList = {
  /** `path` is relative to the drive root ('' = My Drive, or "Shared with me" for members). */
  Folder: { path: string; title: string };
  Search: undefined;
  Viewer: { entry: Entry };
  Share: { path: string; name: string };
};

/** Owner-only Admin tab: people & access, and the activity log. */
export type AdminStackParamList = {
  People: undefined;
  Activity: undefined;
};

/** The bottom tabs. Admin is only registered for the owner. Uploads show in a floating panel, not a tab. */
export type MainTabsParamList = {
  Files: NavigatorScreenParams<FilesStackParamList> | undefined;
  Settings: undefined;
  Admin: undefined;
};

/** Root: swap between the sign-in screen and the signed-in tabs. */
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};
