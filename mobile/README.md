# Pocket Drive — Android app

React Native (CLI, TypeScript) app for the drive at **https://drive.bingisainath.com**. It lives in the
same repository as the backend and web app, but is a **standalone project**: its own `package.json`
and `node_modules`. Nothing here affects how the server is installed or deployed on the phone.

| | |
|---|---|
| App name | Pocket Drive |
| Package (application ID) | `com.bingisainath.pocketdrive`, **permanent** once on Google Play |
| React Native | 0.87.1 (New Architecture, Hermes) |
| Android | minSdk 24 (Android 7), targetSdk **36** (Google Play's requirement from 31 Aug 2026), compileSdk 36 |
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

## Set up a development machine (Ubuntu)

Do this on the machine you sit at with the phone plugged in — not the home server. The app talks to
the live backend over the internet, so the dev machine needs nothing from the server.

```bash
# 1. Node 22 (React Native 0.87 needs >= 22.11; the server's Node 20 is too old for this)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh && nvm install 22 && nvm use 22

# 2. JDK 17 and the tools adb needs
sudo apt update && sudo apt install -y openjdk-17-jdk unzip android-sdk-platform-tools-common

# 3. Android SDK command-line tools only - no Android Studio, no emulator
mkdir -p ~/Android/Sdk/cmdline-tools && cd ~/Android/Sdk/cmdline-tools
curl -fsSLO https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -q commandlinetools-linux-*.zip && mv cmdline-tools latest && rm commandlinetools-linux-*.zip
```

Add to `~/.bashrc`, then open a new shell:

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

```bash
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.1.0"
sdkmanager --licenses      # accept all; Gradle refuses to build otherwise
```

**Disk:** SDK + NDK 6-8 GB, Gradle caches 3-5 GB, `node_modules` ~350 MB. Skipping Android Studio and
the emulator saves several GB more; a real phone over USB replaces both.

Check with `npx react-native doctor` inside `mobile/`.

### The Linux-only gotcha: USB permissions

On Windows this is a driver install. On Linux, `adb devices` will show your phone as `no permissions`
unless udev knows about it. `android-sdk-platform-tools-common` (installed above) provides the rules
for most devices. If yours still shows `no permissions`:

```bash
lsusb                                   # find your phone's vendor id, e.g. 18d1 for Google
sudo tee /etc/udev/rules.d/51-android.rules <<<'SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0664", GROUP="plugdev"'
sudo udevadm control --reload-rules && sudo udevadm trigger
sudo usermod -aG plugdev $USER          # log out and back in
```

## Run it on your phone

```bash
git clone https://github.com/bingisainath/pocket-drive.git
cd pocket-drive/mobile
npm install
```

On the phone: Settings → About phone → tap *Build number* 7 times → Developer options → **USB
debugging** on. Connect it by USB, accept the prompt, and check `adb devices` lists it.

```bash
npm start                 # terminal 1: Metro (the JavaScript dev server, live reload)
npm run android           # terminal 2: builds and installs the debug app
```

**No USB cable?** Android 11+ can pair over Wi-Fi: on the phone, Developer options → *Wireless
debugging* → *Pair device with pairing code*, then `adb pair <ip>:<port>` and `adb connect <ip>:<port>`.
This also works over Tailscale, which is what makes it possible to keep the toolchain on one machine
and the phone anywhere.

**Faster first builds with less disk:** `npm run android -- --active-arch-only` builds native code only
for your phone's CPU instead of all four architectures.

Other scripts: `npm test`, `npm run lint`, `npm run typecheck`.

The debug app talks to the **live drive**, so sign in with your real owner password. Everything you do
(create, delete) happens on your real drive.

## Release builds: APK and AAB

### 1. Create your upload key (once, and keep it safe)

```bash
mkdir -p ~/keys && cd ~/keys
keytool -genkeypair -v -storetype PKCS12 -keystore pocketdrive-upload.keystore -alias pocketdrive-upload -keyalg RSA -keysize 2048 -validity 10000
chmod 600 pocketdrive-upload.keystore
```

Store it **outside the repository** and back it up somewhere you will still have in five years.
`*.keystore` files are git-ignored, apart from the template's public debug key.

This key is permanent. Google Play identifies every future update of
`com.bingisainath.pocketdrive` by it: lose it and you cannot ship an update under the same listing,
and there is no reset. Treat it like the only copy of a house key, not like a build artefact.

### 2. Tell Gradle where it is, outside the repo

Add to `~/.gradle/gradle.properties` (create the file if needed, and `chmod 600` it - it holds
passwords):

```properties
POCKETDRIVE_UPLOAD_STORE_FILE=/home/<you>/keys/pocketdrive-upload.keystore
POCKETDRIVE_UPLOAD_KEY_ALIAS=pocketdrive-upload
POCKETDRIVE_UPLOAD_STORE_PASSWORD=<your store password>
POCKETDRIVE_UPLOAD_KEY_PASSWORD=<your key password>
```

`android/app/build.gradle` signs release builds with this key when these properties exist. Without
them, it falls back to the debug key, which is fine for testing on your own phone but rejected by
Google Play.

### 3. Build

```bash
cd android
./gradlew assembleRelease   # APK → android/app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease     # AAB → android/app/build/outputs/bundle/release/app-release.aab
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
