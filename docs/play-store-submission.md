# Google Play submission

What Play asks for, answered from what the code actually does. When the app changes, change this and
`backend/src/privacy-page.js` together — a Data safety form that disagrees with the policy is a
rejection, and worse, a lie.

| Field | Value |
|---|---|
| App name | Pocket Drive |
| Package | `com.bingisainath.pocketdrive` (permanent) |
| Privacy policy URL | `https://drive.bingisainath.com/privacy` |
| Account deletion URL | `https://drive.bingisainath.com/delete-account` |

## Data safety form

**Does your app collect or share any of the required user data types?** → **Yes**

Answer these for every type below: collected **Yes**, shared **No** (nothing is shared for anyone
else's purposes; sign-in and push are processing on the owner's behalf), encrypted in transit **Yes**,
users can request deletion **Yes** (in-app, Settings → Delete account).

| Category | Type | Purpose | Required or optional |
|---|---|---|---|
| Personal info | Name | App functionality (identify who shared what) | Required |
| Personal info | Email address | App functionality (account identity, invitations) | Required |
| Photos and videos | Photos, Videos | App functionality (you upload them; camera backup if enabled) | **Optional** — camera backup is off until turned on |
| Files and docs | Files and docs | App functionality (the purpose of the app) | Required |
| App activity | Other user-generated content | App functionality (the owner's activity log) | Required |
| Device or other IDs | Device or other IDs | App functionality (the FCM token, to deliver notifications) | Required |

Notes for the reviewer-facing answers:

- **No advertising or marketing** purposes anywhere. No analytics SDK. No ad ID.
- **IP addresses** appear in the activity log. Play does not have an "IP address" data type; it is
  covered by App activity, and the privacy policy states it explicitly.
- **Biometrics are not collected.** The app lock uses Android's `BiometricPrompt`, which returns only
  pass or fail. No biometric data reaches the app, so nothing is declared here.

## Other required declarations

| Question | Answer |
|---|---|
| Target audience | 18+. Not designed for or directed at children |
| Ads | No ads |
| In-app purchases | None |
| Content rating questionnaire | No objectionable content; user-generated content is private to the owner's drive and not publicly browsable |
| Government app | No |
| Financial features | None |
| Data deletion | In-app, plus a public page at the URL above |
| Photo/video permissions | `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`: the user picks files to upload, and camera backup uploads new media after being switched on |
| Foreground service | `dataSync`: finishing uploads the user started while the app is in the background |

## Before uploading a build

1. Raise `versionCode` by at least 1, and `versionName`, in `mobile/android/app/build.gradle`.
2. `cd mobile/android && ./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.
3. Confirm it is signed with the **upload key**, not the debug key:
   `keytool -printcert -jarfile app-release.aab` — the fingerprint must match the one registered for the
   OAuth client, or Google sign-in fails in the published build while working perfectly in debug.
4. Check `https://drive.bingisainath.com/privacy` loads publicly, from a browser with no session.

## The two-Google-projects trap

Sign-in lives in `drive-508517` (`497807800114`); push lives in `pocket-drive-1b585` (`382192207138`).
The release signing SHA-1 belongs to the **OAuth** project; the backend's FCM service account belongs to
the **FCM** project. Putting either in the wrong place produces failures that look unrelated to the cause.
