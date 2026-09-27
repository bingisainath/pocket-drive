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
| Content rating questionnaire | Category: **All other app types**. See below |
| Government app | No |
| Financial features | None |
| Data deletion | In-app, plus a public page at the URL above |
| Photo/video permissions | `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`: the user picks files to upload, and camera backup uploads new media after being switched on |
| Foreground service | `dataSync`: finishing uploads the user started while the app is in the background |

### Content rating: pick "All other app types"

Not "Social or communication". That category is for apps whose *primary purpose* is meeting or talking
to people. Pocket Drive shares folders with people the owner already invited; there is no messaging, no
profiles and no discovery. Choosing it triggers a longer questionnaire and a higher rating for nothing.

Everything about violence, sexual content, profanity, drugs, gambling and purchases is "no". The ones
that need thought:

| Question | Answer | Why |
|---|---|---|
| Ratings-relevant content in the app package | **No** | the APK ships UI, icon and splash only |
| Users can interact or exchange content (voice, text, images, audio) | **Yes** | shared folders: a contributor uploads, other members see it. No chat, but that still counts |
| Is shared UGC the primary source of content? | **Yes** | there is no first-party content; every file is user-uploaded |
| Permits **public** sharing of nudity | **No** | nothing is public; access needs an owner invitation |
| Permits **public** sharing of graphic violence | **No** | same |
| Ability to block users or content | **Yes** | the owner can revoke access and delete anything. Arguable - there is no per-user block button and non-owners cannot block. "No" is also defensible; pick on accuracy, not on the rating it produces |
| Ability to report users or content | **No** | no reporting feature exists |
| Chat moderation | **No** | there is no chat |
| Can interactions be limited to invited friends only? | **Yes** | invite-only is the design, not a setting |

Note the word **public** in the nudity and violence questions: they ask whether strangers can broadcast
such content, and here nobody sees anything without an invitation.

"Yes" to exchanging content has to match the Data safety form, which declares Photos/Videos and Files.
They agree. Answering no here to look tidier is the contradiction that surfaces at the next update.

Expect Teen/PEGI 12 in some regions, purely because UGC is the primary content and there is no reporting
feature. That is normal for a private file app.

The remaining sections are all **no**:

| Question | Answer | Why |
|---|---|---|
| Online content: features or promotes content not in the download | **No** | the examples are catalogues the app supplies (Netflix, Spotify, Amazon). This app supplies none - the files are the user's own, already declared as UGC above. Answering yes double-counts the same thing and invites follow-ups about moderating a catalogue that does not exist |
| Promotes or sells age-restricted products | No | |
| Shares precise physical location with other users | **No** | the manifest declares no location permission of any kind |
| Users can purchase digital goods | No | nothing is paid |
| Cash rewards, gift cards, play-to-earn, crypto, NFTs | No | |
| Web browser or search engine | **No** | the in-app search covers the user's own files; the app can only reach its own backend |
| Primarily news or educational | No | |

## The trap that breaks sign-in after release

With **Play App Signing** (default, and required for AABs) there are **two** signing keys:

| Key | Who holds it | Signs |
|---|---|---|
| **Upload key** | you | the AAB you upload, and release builds you install yourself |
| **App signing key** | Google | the APKs users actually install from Play |

Google strips your upload signature and re-signs. So the certificate in the installed app is **Google's**,
not yours — and Google Sign-In checks the installed app's certificate.

**Register both SHA-1s on the Android OAuth client in `drive-508517`:**

- your upload key's, so release builds you sideload can sign in;
- **Play's app signing key's**, so the published app can. Play Console → *Test and release* → *Setup* →
  *App signing* shows it, available once the first AAB is uploaded.

Miss the second and sign-in works perfectly in every build you test and fails for every real user — with
nothing in your own logs to explain it.

## Step 0 — check the AAB before uploading

```bash
cd mobile/android
# versionCode must be higher than anything ever uploaded; Play rejects a repeat outright
grep -E "versionCode|versionName" app/build.gradle

# signed with the upload key, not the debug key
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
```

A debug certificate says `CN=Android Debug`. If you see that, the Gradle signing properties in
`~/.gradle/gradle.properties` were not picked up, and Play will reject the upload.

Optional but worth it once — install exactly what Play will serve, rather than your own build:

```bash
# bundletool from https://github.com/google/bundletool/releases
java -jar bundletool.jar build-apks --bundle=app-release.aab --output=pd.apks \
  --ks=~/keys/pocketdrive-upload.keystore --ks-key-alias=pocketdrive-upload
java -jar bundletool.jar install-apks --apks=pd.apks
```

Also confirm, from a browser with no session, that `https://drive.bingisainath.com/privacy` loads —
Play fetches it and a policy behind a login counts as no policy.

## The two-Google-projects trap

Sign-in lives in `drive-508517` (`497807800114`); push lives in `pocket-drive-1b585` (`382192207138`).
The release signing SHA-1 belongs to the **OAuth** project; the backend's FCM service account belongs to
the **FCM** project. Putting either in the wrong place produces failures that look unrelated to the cause.

## Step 1 — create the app (once)

Play Console → *Create app*. App name **Pocket Drive**, default language, type **App**, **Free**.
Accept the declarations. The package `com.bingisainath.pocketdrive` is fixed at first upload and can
never be changed — a new package means a new listing with no shared installs or reviews.

## Step 2 — App content (every question must be answered)

*Monetise* and *Policy → App content* in the sidebar. Play will not let you publish with any of these
outstanding:

| Item | Answer |
|---|---|
| Privacy policy | `https://drive.bingisainath.com/privacy` |
| App access | **All functionality is restricted.** The drive is invite-only, so give reviewers working credentials, or they will reject it as broken. See below |
| Ads | No ads |
| Content rating | Complete the questionnaire; nothing objectionable |
| Target audience | 18+ |
| Data safety | Use the table earlier in this file |
| Data deletion | `https://drive.bingisainath.com/delete-account` |
| Government apps | No |
| Financial features | None |
| Health | No |

**App access is the one people forget.** A reviewer who cannot sign in sees a login wall and rejects the
app. Either supply a test account's credentials under *App access → All or some functionality is
restricted*, or invite a Google address you control and hand over that sign-in. Note it expires when you
delete that account.

## Step 3 — Store listing

*Grow → Store presence → Main store listing*:

| Field | Limit | Notes |
|---|---|---|
| App name | 30 chars | Pocket Drive |
| Short description | 80 chars | shown first; write it for someone who has never heard of it |
| Full description | 4000 chars | |
| App icon | 512×512 PNG | 32-bit, no transparency |
| Feature graphic | 1024×500 | required even though it is easy to miss |
| Phone screenshots | **2 minimum**, 2–8 typical | 16:9 or 9:16, 320–3840 px per side |

Screenshots are the whole listing for most people. Take them on a real device with real content:

```bash
adb exec-out screencap -p > shot-1.png
```

## Step 4 — Create the release

*Test and release → Production → Create new release*:

1. Upload `app-release.aab`. Play verifies the signature and shows the version it read.
2. Release notes — what changed. For 1.0.0, what the app is.
3. *Next* → *Save* → *Go to overview* → **Send for review**.

Your Play account predates 13 Nov 2023, so per the project notes production is available directly.
Newer personal accounts must first run a closed test with 12+ testers opted in for 14 consecutive days.
If Console insists on closed testing, that requirement is why — it is an account property, not a
setting you can turn off.

## Step 5 — After it goes live

1. **Install from Play on a device that has never had your debug build** and sign in with Google. This is
   the only real test of the app-signing SHA-1 above. A sideloaded build proves nothing here.
2. Send yourself a share notification to confirm FCM works with the Play-signed build.
3. Watch *Quality → Android vitals* for crashes in the first days.

Reviews typically take a few days for a first submission and can come back asking for clarification —
most often about the photo and video permissions, which is why they are declared as core functionality.

## Updating later

1. Raise `versionCode` (always) and `versionName` (when users would notice).
2. `./gradlew bundleRelease`, upload, release notes, submit.
3. Consider a **staged rollout** (e.g. 20%) so a bad release reaches few people before you halt it.
