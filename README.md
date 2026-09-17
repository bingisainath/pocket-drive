# Cloud Drive

A minimal, self-hosted Google Drive for an Android phone: upload, browse, preview and download your
files from any device, and share folders with friends. One Node.js process serves both the API and
the web app on a single port, so you can point `tailscale serve` / `tailscale funnel` straight at it.

- **Upload** by drag-and-drop or file picker, many files at once, with per-file progress, cancel and retry.
  Files go up in resumable 16 MB chunks: a dropped connection continues where it stopped, adding the same
  file again after closing the tab resumes it, and files of any size get through Cloudflare's 100 MB
  request limit. Chunks stream straight to disk (constant memory).
- **Browse** in a thumbnail grid or a list, sorted newest first (or by name, size, or oldest first),
  with folders, breadcrumbs and search.
- **Preview** images, video, audio, PDFs and text files in the browser. Photos open as fast, screen-sized
  previews (iPhone HEIC included), with the original loaded when you zoom in. Videos stream adaptively
  (480p–1080p, like YouTube), so they start quickly and play in every browser, even the HEVC videos
  phones record. Swipe or use the arrow keys to move between photos.
- **Delete** files and folders, with a confirmation step.
- **Share folders with friends** by email. Everyone signs in with Google, and each person gets a role
  per folder: Viewer, Contributor or Editor. Folders you don't share stay invisible to them.
- **Owner tools**: see who has access to what, remove people, and review an activity log of sign-ins,
  uploads, deletes and sharing changes.
- **Mobile first**: big tap targets, a floating + button, long-press for actions, and the phone's back
  button closes the preview.
- **Storage meter** (owner only) showing space used by Drive and space free on the device.

## Quick start (on the phone)

Inside Termux → `proot-distro login debian`, with Node.js ≥ 20.12:

```bash
cd ~/cloud-drive
apt install ffmpeg libheif-examples libheif-plugin-libde265  # video streaming + iPhone HEIC photos
npm run setup          # install backend + frontend dependencies
npm run hash-password  # choose the owner's backup password (saved as a hash in backend/.env)
npm run build          # build the web app into frontend/dist
npm start              # serve everything on http://127.0.0.1:3000
```

Open <http://127.0.0.1:3000> in the phone's browser to check it works. At this point only you can sign
in, with the password. To let friends in, set up Google sign-in as described below.

### Access it from anywhere with Tailscale

Run these wherever `tailscaled` is running:

```bash
tailscale serve --bg 3000                # private: only devices on your tailnet
tailscale funnel --bg --https=8443 3000  # public, on port 8443 (443 and 10000 also work)
```

You get `https://<phone-name>.<tailnet>.ts.net[:port]`, with HTTPS handled by Tailscale. Stop with
`tailscale funnel --https=8443 off` or `tailscale serve reset`.

The server listens on `127.0.0.1` by default, so it is only reachable through Tailscale. If you'd rather
connect to the phone's Tailscale IP directly (`http://100.x.y.z:3000`), set `HOST=0.0.0.0` in
`backend/.env`. Be aware that this also exposes the server on your Wi-Fi network over plain HTTP.

### Keep it running

Android kills background apps aggressively. To keep the server alive:

- Run `termux-wake-lock` in Termux, or tap *Acquire wakelock* in the Termux notification.
- Turn off battery optimization for Termux in Android settings.
- Best: run it as a Termux service (`termux-services`), so it restarts on its own when it crashes and
  whenever Termux starts. A quick alternative is `tmux new -s drive 'npm start'`.

### Watchdog

runit restarts a service whose process dies, but not one that keeps running while no longer working:
Tailscale stuck "network is down" after a Wi-Fi drop, a tunnel that lost its connections, or a frozen
server. [`ops/watchdog/run`](ops/watchdog/run) is a runit service that checks every minute that the drive
(`/api/health`), the portfolio, `cloudflared` (its `/ready` endpoint) and `tailscaled` answer. After 3
failed checks in a row it restarts the service, and kills it if it won't stop. Tailscale and cloudflared
only count as failing while the phone itself is online. Services stopped on purpose with `sv down` are
left alone, and nothing is checked in its first 5 minutes after starting. Install it from Termux:

```bash
cp -r $PREFIX/var/lib/proot-distro/containers/debian/rootfs/root/cloud-drive/ops/watchdog $PREFIX/var/service/
sv status watchdog                         # runit picks it up within a few seconds
tail -f $PREFIX/var/log/sv/watchdog/current
```

`INTERVAL`, `FAIL_LIMIT`, `GRACE` and `CHECKS` can be set at the top of the `run` script's environment;
`DRY_RUN=1 ONCE=1 GRACE=0 ops/watchdog/run` checks everything once without restarting anything.

### Auto-deploy

Pushes to `main` reach the phone on their own. Two halves:

- **CI on GitHub** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): every push and pull
  request runs the backend tests and builds the web app, both on Node 20 like the phone. Heavy work
  stays off the phone, which is the production server.
- **Pull-based deploy on the phone** ([`ops/deploy/`](ops/deploy/deploy.sh)): a runit service checks
  `origin/main` every 2 minutes. Nothing is exposed for this — the phone only makes outbound
  requests. For each new commit it:
  1. skips out if the working tree has uncommitted changes, or if a deploy is already running;
  2. asks GitHub whether that commit's checks passed (waits while they run, refuses a red commit);
  3. fast-forwards **without** rebuilding or restarting when only `mobile/`, `docs/` or `.github/` changed;
  4. otherwise: snapshots the SQLite database (keeping the last 3), installs dependencies if a lock
     file changed, runs the backend tests, builds the web app, and boots the new code on port 3199
     with a throwaway data directory as a smoke test;
  5. restarts the drive and waits for `/api/health`;
  6. on any failure: **rolls back** to the previous commit, rebuilds, restarts, and **pauses
     auto-deploy** until you remove the paused file.

Install it from Termux, once `main` contains it:

```bash
cp -r $PREFIX/var/lib/proot-distro/containers/debian/rootfs/root/cloud-drive/ops/deploy $PREFIX/var/service/
sv status deploy
tail -f $PREFIX/var/log/sv/deploy/current
```

State lives in `/root/cloud-drive-deploy/` (inside Debian): `paused` (why it stopped, delete to
resume), `history.log`, `db/` snapshots, and the last `tests.log`, `build.log` and `smoke.log`.
Pause it yourself with `touch /root/cloud-drive-deploy/paused`, or stop the service with
`sv down deploy`. To deploy by hand, or to try a fix: `bash /root/cloud-drive/ops/deploy/deploy.sh`.
`REPO`, `BRANCH`, `SERVICE`, `HEALTH_URL`, `REQUIRE_CI`, `DEPLOY_PATHS` and the rest are
environment variables, which is also how the script is tested in a sandbox.

### Monitoring

Point a free uptime monitor such as [UptimeRobot](https://uptimerobot.com) at
`https://<your address>/api/health` (HTTP monitor, 5-minute interval, email alerts). It answers
`{"status":"ok"}` when the database works and storage has room, and nothing else, so it's safe to leave
public. Checked from outside, it catches everything the phone can't report itself: the phone off or
offline, the tunnel down, or the server gone.

## Sharing with friends (Google sign-in)

### 1. Create a Google OAuth client (free, one time)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project, e.g. "Drive".
2. Go to **APIs & Services → OAuth consent screen**:
   - Choose **External**.
   - Enter an app name and your email.
   - Keep the default scopes (email, profile, openid).
   - While the app is in **Testing**, only the Google accounts you add as **test users** can sign in
     (up to 100). Either add your friends there, or click **Publish app**. Apps that only ask for
     name and email don't need Google's review.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - **Application type**: Web application.
   - **Authorized redirect URIs**: your public address followed by `/api/auth/google/callback`, e.g.
     `https://tailscale-termux.tail790102.ts.net:8443/api/auth/google/callback`. Add
     `http://localhost:3000/api/auth/google/callback` too if you want Google sign-in on the phone
     itself.
   - Copy the **Client ID** and **Client secret**.

### 2. Configure `backend/.env` and restart

```bash
OWNER_EMAIL=you@gmail.com                                          # your Google account = the owner (admin)
PUBLIC_ORIGINS=https://tailscale-termux.tail790102.ts.net:8443     # comma-separate to add http://localhost:3000
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

On startup the log says `Google sign-in: on for https://…`. The sign-in page now offers **Continue
with Google**. Your password stays available under *Owner? Use your password*, as a backup.

### 3. Share a folder

As the owner, open a folder's **⋮ → Share** (or **Share** in the header), enter your friend's Gmail
address and pick a role:

| Role            | View & download | Upload & create folders | Delete                              |
| --------------- | --------------- | ----------------------- | ----------------------------------- |
| **Viewer**      | ✅              | –                       | –                                   |
| **Contributor** | ✅              | ✅                      | only what they uploaded themselves  |
| **Editor**      | ✅              | ✅                      | anything inside the shared folder   |
| **Owner** (you) | ✅ everywhere   | ✅                      | ✅ (plus sharing, People, Activity) |

Then send them the address (Share → **Copy link**). They sign in with Google and land on **Shared with
me**, which lists only the folders you shared with them.

How access works:

- **Default deny.** Nothing is visible unless it's shared. Private folders and files answer "not found"
  to other people, even if they guess a file's link or id. Search, thumbnails and downloads all
  respect this.
- **Inheritance.** Sharing a folder covers everything inside it. If several shares apply, the strongest
  role wins. For example, Viewer on *Trip* plus Contributor on *Trip/Day 1* means they can upload to
  Day 1 only.
- **Changes are immediate.** Unsharing, or removing someone under **⋮ → People & access**, takes effect
  on their very next click. Removing a person also signs them out. Files they added stay, and count as
  yours.
- **One Google account per email.** An email stays tied to the first Google account that signed in
  with it.
- **Activity log.** **⋮ → Activity** lists sign-ins (including refused ones), uploads, new folders,
  deletes and sharing changes, kept for `ACTIVITY_RETENTION_DAYS`.

## Configuration

All settings live in `backend/.env`. `npm run hash-password` creates this file from
[`backend/.env.example`](backend/.env.example).

| Variable                  | Default           | Notes                                                                   |
| ------------------------- | ----------------- | ----------------------------------------------------------------------- |
| `PORT`                    | `3000`            |                                                                         |
| `HOST`                    | `127.0.0.1`       | `0.0.0.0` exposes it on every network interface.                        |
| `DATA_DIR`                | `~/cloud-storage` | Holds `files/`, the SQLite database, and the thumbnail cache.           |
| `STORAGE_DIR`             | `$DATA_DIR/files` | Where your files actually live (see below).                             |
| `MAX_UPLOAD_MB`           | `4096`            | Per-file limit.                                                         |
| `UPLOAD_CHUNK_MB`         | `16`              | Size of each upload request. Keep it under your proxy's limit (Cloudflare free: 100 MB). |
| `FFMPEG` / `FFPROBE`      | `ffmpeg` / `ffprobe` | Used to make streaming versions of videos. Without them, videos play as uploaded. |
| `HEIF_DECODER`            | `heif-dec`        | libheif's decoder, for iPhone HEIC photos sharp can't read.             |
| `MIN_FREE_MB`             | `500`             | Uploads are refused if they'd leave less than this free on the device. |
| `SESSION_DAYS`            | `30`              | Sessions extend automatically while you keep using the app.            |
| `LOGIN_MAX_ATTEMPTS`      | `10`              | Failed password logins per IP, per window, before a temporary lockout.  |
| `LOGIN_WINDOW_MINUTES`    | `15`              |                                                                         |
| `PASSWORD_HASH`           | —                 | Required. The owner's backup password; set it with `npm run hash-password`. |
| `OWNER_EMAIL`             | —                 | Your Google account. Required for Google sign-in.                       |
| `PUBLIC_ORIGINS`          | —                 | Addresses where Google sign-in is offered (each must match a redirect URI). |
| `GOOGLE_CLIENT_ID`        | —                 | From your Google OAuth client.                                          |
| `GOOGLE_CLIENT_SECRET`    | —                 | From your Google OAuth client. Keep it private.                         |
| `ACTIVITY_RETENTION_DAYS` | `180`             | `0` keeps the activity log forever.                                     |

To change the password, run `npm run hash-password` again and restart; the owner is signed out
everywhere.

**Upgrading from the single-password version:** the first start upgrades the database in place in a
fraction of a second. Files aren't touched, and existing files count as the owner's. Everyone is signed
out once.

## How it works

```
cloud-drive/
├── package.json           # top-level scripts (setup, build, start, test, …)
├── backend/               # Express 5 API + static file server (plain ESM JavaScript, no build step)
│   ├── src/
│   │   ├── server.js      # entry point: config, startup scan, HTTP server
│   │   ├── app.js         # routes, SPA fallback, error handling, security headers
│   │   ├── routes/        # auth (password + Google), files (every route permission-checked), admin (owner)
│   │   ├── access.js      # folder shares and the permission checks built on them
│   │   ├── users.js       # accounts: the owner and everyone a folder is shared with
│   │   ├── google.js      # "Sign in with Google" (OpenID Connect with PKCE, state and nonce)
│   │   ├── activity.js    # the activity log
│   │   ├── uploads.js     # streaming multipart → temp file → atomic rename
│   │   ├── resumable.js   # chunked, resumable uploads (partial files kept for 24 h)
│   │   ├── scanner.js     # re-syncs the SQLite index with what's on disk
│   │   ├── thumbnails.js  # sharp → 400px thumbnails + 1600px previews (WebP), HEIC via libheif
│   │   ├── streams.js     # ffmpeg → adaptive HLS (480p + up to 1080p) for videos
│   │   ├── db.js          # SQLite schema, migrations + queries (better-sqlite3)
│   │   ├── auth.js        # scrypt hashing, sessions, login throttling
│   │   └── paths.js       # filename sanitizing + path traversal protection
│   ├── scripts/hash-password.js
│   └── test/              # API tests + sharing/permission tests (node:test, with a stand-in for Google)
├── frontend/              # React 19 + Vite + TypeScript + Tailwind 4
│   └── src/
│       ├── components/    # Drive, grid/list views, previewer, Share/People/Activity dialogs, upload panel
│       ├── hooks/         # upload queue, long-press, URL-synced folder path, overlays
│       └── api.ts         # typed API client (XHR for uploads, to get progress)
├── e2e/run.mjs            # headless-Chromium end-to-end test
├── ops/watchdog/          # runit service that restarts hung services on the phone
└── ops/deploy/            # runit service that deploys pushes to main (CI-gated, with rollback)
```

- **Your files are real files.** A folder in the app is a real folder under `STORAGE_DIR`, and each file
  keeps its own name. You can back up that directory, browse it from Termux, or add files by hand.
  Permissions live only in the database, and files you add by hand inherit their folder's sharing.
- **SQLite holds the index plus accounts.** The index covers names, sizes, types, upload dates and
  folder paths, and is re-synced with the disk on every start and from *⋮ → Sync with disk*. Accounts,
  shares, sessions and the activity log live alongside it.
- **Uploads** arrive in chunks (`POST /api/uploads`, then `PUT /api/uploads/:id` with `Upload-Offset`)
  into a hidden directory on the same filesystem, then are atomically renamed into place. They never
  overwrite anything: a name clash becomes `photo (1).jpg`. A partial upload belongs to the user, folder,
  name, size and modification time, so adding the same file again resumes it; untouched partials are
  deleted after 24 hours.
- **Previews are sandboxed.** Images, video, audio and PDF are served inline. HTML and SVG are served
  inside a CSP sandbox so they can't run scripts on your drive's origin. Everything else downloads.
- **Thumbnails and previews** (400px and 1600px WebP) are generated on upload, for anything missing in
  the background after startup, or the first time they're viewed, and cached in `DATA_DIR/thumbs`. iPhone
  HEIC photos are HEVC-coded, which sharp's prebuilt binary can't decode, so they go through libheif's
  `heif-dec` first.
- **Videos** get an adaptive streaming version in `DATA_DIR/streams/<id>`: HLS in two qualities by the
  picture's short side (480p, plus the source's size up to 1080p), H.264/AAC in 4-second segments, at most
  30 fps. ffmpeg makes them one at a time at low CPU priority, after upload and for older videos after
  startup. A phone's CPU needs roughly 2 minutes per minute of 1080p video, and ~10 per minute of 4K. The
  player uses hls.js (or Safari's built-in HLS) and plays the original until the streaming version is
  ready.

To put the files in Android shared storage, so they show up in the phone's Files app, run
`termux-setup-storage` and set `STORAGE_DIR` to a folder there, for example `/sdcard/CloudDrive`. The
exact path depends on how proot-distro mounts storage. File names are already sanitized for that
filesystem's rules.

## Development

```bash
npm run dev:backend    # API on :3000, restarts on changes (needs backend/.env)
npm run dev:frontend   # Vite on :5173 with hot reload, proxies /api to :3000
npm test               # backend API + sharing/permission test suites
```

### Browser tests

`e2e/run.mjs` starts the real server with a throwaway data directory on a random port, so it never
touches your files. It uses a stand-in for Google, so no real Google account is needed. It then
drives the built app in headless Chromium, at phone and desktop sizes, through these flows:

- password and Google sign-in
- uploads, folders and the back button
- photo, PDF and text previews, including swiping
- long-press delete and search
- list, grid and dark mode
- drag-and-drop and right-click
- sharing a folder, a friend's limited view, and a refused sign-in
- People & access and Activity

It fails on any console error or CSP violation, and saves screenshots to `e2e/screenshots/`.

```bash
apt install chromium       # once, or set CHROME_PATH to an existing Chrome/Chromium
npm --prefix e2e install   # once
npm run build              # the test runs against the built frontend
npm run test:e2e
```

## Troubleshooting

- **"PASSWORD_HASH is not set"**: run `npm run hash-password`.
- **"Frontend not built yet"** at `/`: run `npm run build`, then restart.
- **No "Continue with Google" button**: check the startup log. `OWNER_EMAIL`, `PUBLIC_ORIGINS` and
  both Google values must all be set, and you must open the drive at an address listed in
  `PUBLIC_ORIGINS`.
- **Google says `redirect_uri_mismatch`**: the redirect URI in Google Cloud must be exactly
  `<origin from PUBLIC_ORIGINS>/api/auth/google/callback`, including the port.
- **A friend sees "doesn't have access"**: share a folder with the exact email of the Google account
  they picked. Also check they're a test user, if the consent screen is still in Testing.
- **Crash or segfault on startup after changing Node versions**: `better-sqlite3` and `sharp` are
  native modules. Run `npm --prefix backend rebuild`, or delete `backend/node_modules` and run
  `npm run setup` again. `better-sqlite3` is pinned to v11 because v12 and later require Node ≥ 22.
- **Uploads fail through Tailscale Funnel but work locally**: check the Tailscale logs for proxy limits,
  and try `tailscale serve` (tailnet-only) to narrow down whether Funnel is the cause.
- **A video says "a version that plays everywhere is being prepared"**: your browser can't decode the
  original (usually HEVC). Its streaming version is still converting; the log line
  `Streaming version of "…" ready` shows when it's done. `No streaming version for "…"` means ffmpeg
  failed or isn't installed.
- **A service keeps restarting**: `tail $PREFIX/var/log/sv/watchdog/current` shows which check failed.
  Stop the watchdog with `sv down watchdog` while debugging.
