# Cloud Drive

A minimal, self-hosted Google Drive for an Android phone: upload, browse, preview and download your
files from any device. One Node.js process serves both the API and the web app on a single port, so
you can point `tailscale serve` / `tailscale funnel` straight at it.

- **Upload** by drag-and-drop or file picker, many files at once, with per-file progress, cancel and retry.
  Uploads stream straight to disk (constant memory — a 1 GB file uses ~3 MB of RAM).
- **Browse** in a thumbnail grid or a list, sorted newest first (or by name, size, or oldest first),
  with folders, breadcrumbs and search across all folders.
- **Preview** images, video, audio, PDFs and text files in the browser. Swipe or use the arrow keys to
  move between photos.
- **Delete** files and folders, with a confirmation step.
- **Mobile first**: big tap targets, a floating + button, long-press for actions, and the phone's back
  button closes the preview.
- **Storage meter** showing space used by Drive and space free on the device.
- **Password gate** stored as a scrypt hash, with an HttpOnly session cookie and login throttling.

## Quick start (on the phone)

Inside Termux → `proot-distro login debian`, with Node.js ≥ 20.12:

```bash
cd ~/cloud-drive
npm run setup          # install backend + frontend dependencies
npm run hash-password  # choose your password (saved as a hash in backend/.env)
npm run build          # build the web app into frontend/dist
npm start              # serve everything on http://127.0.0.1:3000
```

Open <http://127.0.0.1:3000> in the phone's browser to check it works.

### Access it from anywhere with Tailscale

Run these wherever `tailscaled` is running:

```bash
tailscale serve --bg 3000     # private: only devices on your tailnet
tailscale funnel --bg 3000    # public: anyone with the URL gets the login page
```

Either way you get `https://<phone-name>.<tailnet>.ts.net`, with HTTPS handled by Tailscale. Stop with
`tailscale serve reset` or `tailscale funnel reset`.

The server listens on `127.0.0.1` by default, so it is only reachable through Tailscale. If you'd rather
connect to the phone's Tailscale IP directly (`http://100.x.y.z:3000`), set `HOST=0.0.0.0` in
`backend/.env`. Be aware that this also exposes the server on your Wi-Fi network over plain HTTP.

### Keep it running

Android kills background apps aggressively. To keep the server alive:

- Run `termux-wake-lock` in Termux, or tap *Acquire wakelock* in the Termux notification.
- Turn off battery optimization for Termux in Android settings.
- Start the server inside `tmux` so it survives closing the terminal: `tmux new -s drive 'npm start'`.
  Reattach later with `tmux attach -t drive`.

## Configuration

All settings live in `backend/.env`. `npm run hash-password` creates this file from
[`backend/.env.example`](backend/.env.example).

| Variable               | Default            | Notes                                                                   |
| ---------------------- | ------------------ | ----------------------------------------------------------------------- |
| `PORT`                 | `3000`             |                                                                         |
| `HOST`                 | `127.0.0.1`        | `0.0.0.0` exposes it on every network interface.                        |
| `DATA_DIR`             | `~/cloud-storage`  | Holds `files/`, the SQLite index, and the thumbnail cache.              |
| `STORAGE_DIR`          | `$DATA_DIR/files`  | Where your files actually live (see below).                             |
| `MAX_UPLOAD_MB`        | `4096`             | Per-file limit.                                                         |
| `MIN_FREE_MB`          | `500`              | Uploads are refused if they'd leave less than this free on the device. |
| `SESSION_DAYS`         | `30`               | Sessions extend automatically while you keep using the app.            |
| `LOGIN_MAX_ATTEMPTS`   | `10`               | Failed logins per IP, per window, before a temporary lockout.           |
| `LOGIN_WINDOW_MINUTES` | `15`               |                                                                         |
| `PASSWORD_HASH`        | —                  | Required. Set it with `npm run hash-password`.                          |

To change the password, run `npm run hash-password` again and restart. Everyone gets signed out.

## How it works

```
cloud-drive/
├── package.json           # top-level scripts (setup, build, start, test, …)
├── backend/               # Express 5 API + static file server (plain ESM JavaScript, no build step)
│   ├── src/
│   │   ├── server.js      # entry point: config, startup scan, HTTP server
│   │   ├── app.js         # routes, SPA fallback, error handling
│   │   ├── routes/        # /api/auth/*, /api/{list,search,upload,folders,files,entries,storage,rescan}
│   │   ├── uploads.js     # streaming multipart → temp file → atomic rename
│   │   ├── scanner.js     # re-syncs the SQLite index with what's on disk
│   │   ├── thumbnails.js  # sharp → 400px WebP, cached on disk
│   │   ├── db.js          # SQLite schema + queries (better-sqlite3)
│   │   ├── auth.js        # scrypt hashing, sessions, login throttling
│   │   └── paths.js       # filename sanitizing + path traversal protection
│   ├── scripts/hash-password.js
│   └── test/api.test.js   # end-to-end API tests (node:test)
└── frontend/              # React 19 + Vite + TypeScript + Tailwind 4
    └── src/
        ├── components/    # Drive (main screen), grid/list views, previewer, dialogs, upload panel
        ├── hooks/         # upload queue, long-press, URL-synced folder path, overlays
        └── api.ts         # typed API client (XHR for uploads, to get progress)
```

- **Your files are real files.** A folder in the app is a real folder under `STORAGE_DIR`, and each file
  keeps its own name. You can back up that directory, browse it from Termux, or add files by hand.
- **SQLite is only an index** of names, sizes, types, upload dates and folder paths, used for fast
  listing and search. It is re-synced with the disk on every start, and on demand from
  *⋮ → Sync with disk*. If you delete `cloud-drive.db`, the next start rebuilds it; files found this way
  use their modification time as the upload date.
- **Uploads** stream to a hidden temp directory on the same filesystem, then are atomically renamed into
  place. They never overwrite anything: a name clash becomes `photo (1).jpg`. Interrupted uploads are
  cleaned up.
- **Previews are sandboxed.** Images, video, audio and PDF are served inline. HTML and SVG are served
  inside a CSP sandbox so they can't run scripts on your drive's origin. Everything else downloads.
- **Thumbnails** are generated on upload, or the first time they're viewed, and cached in
  `DATA_DIR/thumbs`. iPhone HEIC photos can't be decoded by sharp's prebuilt binary (it lacks the HEVC
  codec), so they show an icon instead. Their downloads are unaffected.

To put the files in Android shared storage, so they show up in the phone's Files app, run
`termux-setup-storage` and set `STORAGE_DIR` to a folder there, for example `/sdcard/CloudDrive`. The
exact path depends on how proot-distro mounts storage. File names are already sanitized for that
filesystem's rules.

## Development

```bash
npm run dev:backend    # API on :3000, restarts on changes (needs backend/.env)
npm run dev:frontend   # Vite on :5173 with hot reload, proxies /api to :3000
npm test               # backend API test suite
```

### Browser tests

`e2e/run.mjs` starts the real server with a throwaway data directory on a random port, so it never
touches your files. It then drives the built app in headless Chromium, at phone and desktop sizes,
through these flows:

- login
- uploads
- folders and the back button
- photo, PDF and text previews, including swiping
- long-press delete
- search
- list, grid and dark mode
- drag-and-drop and right-click
- sign-out

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
- **Crash or segfault on startup after changing Node versions**: `better-sqlite3` and `sharp` are
  native modules. Run `npm --prefix backend rebuild`, or delete `backend/node_modules` and run
  `npm run setup` again. `better-sqlite3` is pinned to v11 because v12 and later require Node ≥ 22.
- **Uploads fail through Tailscale Funnel but work locally**: check the Tailscale logs for proxy limits,
  and try `tailscale serve` (tailnet-only) to narrow down whether Funnel is the cause.
