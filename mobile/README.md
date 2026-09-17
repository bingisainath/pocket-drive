# Pocket Drive — Android app

React Native (CLI, TypeScript) app for the drive at **https://drive.bingisainath.com**. It lives in the
same repository as the backend and web app, but is a **standalone project**: its own `package.json`
and `node_modules`. Nothing here affects how the server is installed or deployed on the phone.

| | |
|---|---|
| App name | Pocket Drive |
| Package (application ID) | `com.bingisainath.pocketdrive`, **permanent** once on Google Play |
| React Native | 0.87.1 (New Architecture, Hermes) |
| Android | minSdk 24 (Android 7), targetSdk **36** (Google Play's requirement from 31 Aug 2026), compileSdk 37 |
| Navigation | React Navigation 7 (native stack) |

## What works already
- **Sign in** with the owner password: the same session cookie as the web app, kept by Android's cookie store.
- **Browse** My Drive or "Shared with me", open folders, pull to refresh, with thumbnails.
- Light and dark mode; loading, empty and error states.
- A typed API client for the live drive, plus the web app's types and helpers (`src/shared`).
- Release signing wired to read your upload key from outside the repo.
- Unit tests for the API client and the shared helpers.

Verified before committing: `tsc` clean, ESLint/Prettier clean, 9/9 tests passing, and a release-mode
Android JavaScript bundle built with Metro. **The native Android build has not been run yet**, because
it needs the Android SDK. Your first `npm run android` is that check.

## Project layout

```
mobile/
├── App.tsx                  providers: safe area, auth, navigation, theme
├── index.js                 app entry (registers "PocketDrive")
├── src/
│   ├── config.ts            API_BASE_URL = https://drive.bingisainath.com
│   ├── theme.ts             light/dark colours
│   ├── api/
│   │   ├── client.ts        fetch wrapper: errors, 401 → sign-out, cookies
│   │   └── drive.ts         typed endpoints + file URLs (thumb, preview, raw, stream)
│   ├── auth/AuthContext.tsx session state: loading / signed in / signed out
│   ├── navigation/          RootNavigator (Login ↔ Folder stack)
│   ├── screens/             LoginScreen, FolderScreen
│   ├── components/          EntryRow, StateView
│   ├── hooks/useFolder.ts   folder listing with refresh
│   └── shared/              COPIES of frontend/src/types.ts and lib/{entries,format}.ts
├── __tests__/               Jest tests
├── android/                 native Android project (Gradle 9.4)
└── ios/                     native iOS project (untouched; needs a Mac)
```

`src/shared/` is copied from the web app so both describe the same API. When you change
`frontend/src/types.ts` or `frontend/src/lib/*`, copy the change here too. They can move to a shared
package later.

## Set up the laptop (Windows)

1. **Node.js 22 LTS**, version **22.13 or newer**. React Native 0.87 requires it.
2. **JDK 17**, e.g. Azul Zulu 17 (the version React Native's docs recommend). Set `JAVA_HOME` to it.
3. **Android SDK:**
   - *Android Studio* (easiest): SDK Manager → install **Android SDK Platform 37**, **Android SDK
     Build-Tools 37.0.0**, **Android SDK Platform-Tools** and **Command-line Tools**. Gradle downloads
     the **NDK 27.1.12297006** on first build if licences are accepted.
   - *Low on disk?* Skip the IDE and emulator: install only the "Command line tools only" package,
     then `sdkmanager "platform-tools" "platforms;android-37" "build-tools;37.0.0"` and
     `sdkmanager --licenses`.
4. Environment variables: `ANDROID_HOME` = the SDK folder (e.g. `%LOCALAPPDATA%\Android\Sdk`), and add
   `%ANDROID_HOME%\platform-tools` to `Path`.
5. **Disk space, roughly:** SDK + NDK 6–8 GB, Gradle caches 3–5 GB, `node_modules` ~350 MB. Android
   Studio itself adds ~3 GB, and an emulator several more. A **real phone over USB avoids the emulator**.

Check everything with `npx react-native doctor` inside `mobile/`.

## Run it on your phone

```powershell
git clone https://github.com/bingisainath/pocket-drive.git
cd pocket-drive\mobile
npm install
```

On the phone: Settings → About phone → tap *Build number* 7 times → Developer options → **USB
debugging** on. Connect it by USB, accept the prompt, and check `adb devices` lists it.

```powershell
npm start                 # terminal 1: Metro (the JavaScript dev server, live reload)
npm run android           # terminal 2: builds and installs the debug app
```

**Faster first builds with less disk:** `npm run android -- --active-arch-only` builds native code only
for your phone's CPU instead of all four architectures.

Other scripts: `npm test`, `npm run lint`, `npm run typecheck`.

The debug app talks to the **live drive**, so sign in with your real owner password. Everything you do
(create, delete) happens on your real drive.

## Release builds: APK and AAB

### 1. Create your upload key (once, and keep it safe)

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore pocketdrive-upload.keystore -alias pocketdrive-upload -keyalg RSA -keysize 2048 -validity 10000
```

Store `pocketdrive-upload.keystore` **outside the repository** (e.g. `C:\Users\<you>\keys\`) and back
it up. `*.keystore` files are git-ignored, apart from the template's public debug key.

### 2. Tell Gradle where it is, outside the repo

Add to `%USERPROFILE%\.gradle\gradle.properties` (create the file if needed):

```properties
POCKETDRIVE_UPLOAD_STORE_FILE=C:/Users/<you>/keys/pocketdrive-upload.keystore
POCKETDRIVE_UPLOAD_KEY_ALIAS=pocketdrive-upload
POCKETDRIVE_UPLOAD_STORE_PASSWORD=<your store password>
POCKETDRIVE_UPLOAD_KEY_PASSWORD=<your key password>
```

`android/app/build.gradle` signs release builds with this key when these properties exist. Without
them, it falls back to the debug key, which is fine for testing on your own phone but rejected by
Google Play.

### 3. Build

```powershell
cd android
.\gradlew assembleRelease   # APK → android\app\build\outputs\apk\release\app-release.apk
.\gradlew bundleRelease     # AAB → android\app\build\outputs\bundle\release\app-release.aab
```

Before each Play Store upload, raise `versionCode` (by 1) and `versionName` in
`android/app/build.gradle`.

### 4. Google Play
- Play Console developer account (one-time $25, identity verification) → create the app with package
  `com.bingisainath.pocketdrive` → enrol in **Play App Signing** → upload the AAB.
- **New personal developer accounts** must run a **closed test with at least 12 testers opted in for
  14 days in a row** before they can publish to production.
- The store listing needs a **privacy policy URL** (e.g. a page on bingisainath.com), the **Data
  safety** form, and a way for users to **request account deletion**.

## Next steps (suggested order)

1. **File viewer:** photo previews (`urls.preview`) with pinch-zoom and swipe, video playback using
   `urls.stream` (HLS) with the original as fallback (Android plays HEVC natively), PDF and text.
2. **Uploads:** pick photos with the **system photo picker** and send them with the drive's resumable
   chunked protocol (`POST /api/uploads`, `PUT /api/uploads/:id` with `Upload-Offset`). See
   `frontend/src/api.ts` → `uploadFile` for the client logic to port.
3. **Folder actions:** new folder, delete with confirmation, search, sort, grid view, storage meter.
4. **Google sign-in:** native Google Sign-In, plus a backend endpoint that verifies the Google ID token
   and issues a session (bearer token), then accepting `Authorization: Bearer` in `requireAuth`. You'll
   need Android OAuth client IDs with the SHA-1 of both your upload key and Play's app-signing key.
5. **Owner tools:** Share dialog, People & access, Activity log (`/api/admin/*`).
6. **Native extras:**
   - background uploads (Android's user-initiated data transfer jobs)
   - optional automatic camera backup (needs `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`, declared as core functionality in Play Console)
   - share-to-app from the gallery
   - push notifications (Firebase Cloud Messaging + device-token endpoints on the backend)

## Known notes
- Metro warns about an import of `ReactNativeFeatureFlags`. It comes from React Native's own list
  package (`@react-native/virtualized-lists`), not from this app. Metro falls back to the file and the
  bundle builds fine.
- The template's ESLint 8 and some transitive packages print deprecation warnings during
  `npm install`; they come from the React Native template's tooling, not the app.
