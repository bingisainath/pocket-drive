# 12. The Android App (18–19 Sep 2026)

After the web app and backend were live and fast, the drive got a **native Android app** — so the
phone that *hosts* the drive can also be the best way to *use* it: background uploads, camera
backup, push notifications and a biometric lock, none of which a browser tab can do well.

| | |
|---|---|
| **Stack** | React Native 0.87 (CLI, New Architecture), React 19, TypeScript · TanStack Query · react-native-mmkv · Kotlin native modules · @react-native-firebase/messaging + Notifee · AndroidX WorkManager, BiometricPrompt, core-splashscreen |
| **Talks to** | the same live backend, `https://drive.bingisainath.com`, over a Bearer token (not the web's cookie) |
| **Runs on** | the owner's Xiaomi (arm64), installed via Metro during development |
| **Shares code** | `types.ts` and the `entries`/`format` libs are copied from the web app and kept in sync by `npm run check:shared` |

## How we worked

Same rule as the rest of the project: **ask before architecture, decide details myself.** Each
phase opened with a short question round. The decisions the user made:

| Decision | Options | Chosen |
|---|---|---|
| Background upload scheduler | user-initiated data-transfer jobs (API 34+) + WorkManager fallback, vs WorkManager everywhere | **UIDT + WorkManager** (correct modern path, visible progress) |
| Reboot resume | queue persists + auto-resume on boot, vs resume on next app open | **Auto-resume on boot** |
| Default network policy | Wi-Fi only (toggle for mobile data), vs any network | **Wi-Fi only by default** |
| Camera backup scope | existing + new, only new, or recent + new | **Only new** (from the moment you enable it) |

## The phases

1. **Foundation** — libraries, theme tokens shared with the web app, primitives, bottom tabs.
2. **Backend additions** — Bearer-token auth, Google ID-token verification, a `devices` table, an FCM
   sender (HTTP v1, no `firebase-admin`), notification events, account deletion. Merged and deployed.
3. **Browsing & viewing** — grid/list, sort, search, breadcrumbs, an offline cache, photo/video/text
   viewer, create/delete folder, storage meter, rescan, downloads via `DownloadManager`.
4. **Uploads** — the heart of the app (below).
5. **Owner tools** — share dialog + roles, people & access, activity log.
6. **Device features** — push, camera backup, app lock (below).
7. **Release** — adaptive icon, splash, versioning, signed AAB.

## Uploads: a durable, background-capable queue

The first upload slice ran a Kotlin resumable uploader (`ResumableUpload`, plain `java.net`, no
extra deps) on a worker thread while the app was open. Phase 4 moved **ownership of the queue out of
JavaScript and into native**, so uploads survive the app being backgrounded, killed or rebooted.

| Piece | Role |
|---|---|
| `UploadQueue` | App-private SQLite; the single source of truth. Atomic `claimNext`, orphan recovery, token refresh |
| `UploadRunner` | One lock-guarded drain loop, up to 4 concurrent, reusing `ResumableUpload`; distinguishes a user-cancel from a system preemption (preempted jobs resume, not fail) |
| `UploadScheduler` | JobScheduler **user-initiated data-transfer job** on API 34+, WorkManager foreground worker on 24–33, with a Wi-Fi-only vs any-network constraint |
| `BootReceiver` | Re-arms the drainer after a reboot while work remains |
| JS store | Became a live mirror, hydrated from the native queue |

A useful discovery: the backend derives a resumable session's id from
`[userId, path, name, size, lastModified]` and returns the existing `.part` size as the offset — so
a restarted job **resumes from the server's byte offset for free**, no protocol change needed.

Kotlin unit tests (Robolectric + MockWebServer) cover the protocol: happy path, 409 resync, 404
restart, retry backoff, 401, and cancel.

**Share-into-app** accepts `ACTION_SEND`. Because the sender only grants transient read access to the
receiving activity, shared content is copied to app cache immediately, so the background uploader can
still read it later.

## Device features

- **Push** — `@react-native-firebase/messaging` registers the FCM token with `/api/devices`; Notifee
  shows foreground messages on the `sharing`/`activity` channels; tapping opens the folder. A gotcha
  worth recording: **sign-in and push live in two different Google Cloud projects** — OAuth/audience
  in `drive-508517` (`497807800114`), FCM in `pocket-drive-1b585` (`382192207138`). The signing SHA-1
  must go in the OAuth project; the backend's FCM service account must belong to the FCM project.
- **Camera backup** — `MediaBackup` scans MediaStore for images/videos newer than a `DATE_ADDED`
  watermark and enqueues them into the same durable queue. Enabling sets the watermark to "now", so
  only new media is uploaded.
- **App lock** — AndroidX `BiometricPrompt` (fingerprint/face, or device PIN) behind an overlay that
  locks on launch and whenever the app returns from the background. The enabled flag lives in its own
  store so it survives sign-out.

## Issues hit and fixed

| Issue | Root cause | Fix |
|---|---|---|
| Uploads failed with **"unexpected end of stream"** | MediaStore's `SIZE` disagreed with the bytes `openInputStream` yields, so the fixed-length request body ended early (and, if too large, the upload could never finish) | Take the size from the content resolver's authoritative `statSize`, in the camera scan and the shared enqueue path |
| Same error, intermittently | `HttpURLConnection` reused a pooled keep-alive socket that Cloudflare had already closed | Send `Connection: close` so each request gets a fresh socket |
| Deleting a photo left a **stuck "1 item"** | A queued item deleted before it uploaded could no longer be read, and lingered as a failed row | Detect a missing source (before and during upload), discard any server session, and drop the job with a silent `removed` event |
| The upload panel **covered the tab bar** | The floating panel only offset for the safe-area inset, not the ~49 dp tab bar | Offset for the tab bar height too |
| Dismiss (X) wouldn't close the panel | `clearFinished` didn't remove `error` rows | Clear failed rows too |
| Manifest merge failed | `react-native-firebase` declares an empty `default_notification_channel_id` | `tools:replace` our value |

## Release prep (Phase 7)

- **Adaptive icon** (API 26+): a white cloud-upload glyph on brand blue `#2563eb`, with a monochrome
  layer for Android 13 themed icons.
- **Splash screen** via `androidx.core:core-splashscreen` — the same icon on brand blue, handing off
  to the app theme once React renders.
- **Version** `1.0.0` (`versionCode` must strictly increase on every Play upload).
- **Signed AAB** with the upload key (SHA-1/256 recorded for the OAuth client and App Links).

The Play Console account predates 13 Nov 2023, so the app can publish straight to production without
a closed test. Remaining before submission: a privacy-policy URL and the Data-safety form (the app
handles uploaded files, camera/photos, notifications and a device identifier).
