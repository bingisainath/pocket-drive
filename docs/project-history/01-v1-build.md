# 1. v1: Building the App (11–12 Sep 2026)

## The request

Build a self-hosted, minimal Google-Drive-like web app that runs on an Android phone in Termux and is
reachable from any device through a Tailscale URL.

- **Stack (specified by the user):** Node.js + Express backend; React + Vite + TypeScript + Tailwind
  frontend; files on the phone's local filesystem; SQLite for metadata; one process on one port serving
  both the API and the built frontend.
- **Features:** multi-file upload (drag-and-drop and picker) with progress; one-click download; list view
  with icons, dates, newest first and search; folders with breadcrumbs; delete with confirmation; inline
  image/PDF preview; a single hashed password with a session cookie (because it would be public via
  Funnel).
- **UI:** mobile first (the main use is uploading phone photos), grid with thumbnails plus a list toggle,
  big tap targets, a floating upload button, long-press/swipe actions, and storage used vs free.
- **Constraints:** runs in proot Debian on arm64; avoid native modules that need special ARM handling;
  stream uploads instead of loading them into memory; configurable size limit.
- **Process:** scaffold, then backend API, then frontend. *"Ask me before making major architecture
  decisions I haven't specified."*

## Environment findings

| Finding | Consequence |
|---|---|
| Termux → proot-distro Debian 13, aarch64, glibc; Node 20.19, npm 9 | Native modules need linux-arm64-glibc prebuilds that support Node 20 |
| `better-sqlite3` v12+ requires Node ≥ 22. On Node 20 it installed, then **segfaulted on load** | Pinned to `better-sqlite3@^11` |
| `sharp` prebuilt binary works on arm64 | Server-side thumbnails are possible without compiling |
| sharp's prebuilt libvips **cannot decode HEVC-coded HEIC** (iPhone photos) | HEIC showed an icon in v1 (fixed on 16 Sep, see [chapter 8](08-media-and-reliability.md)) |
| No browser in Debian | UI couldn't be tested; Chromium was installed after asking (see below) |

## Design decisions (question round, 11 Sep 22:19)

The user accepted all three recommendations.

### Storage layout: mirrored folders ✅
| Option | Pros | Cons |
|---|---|---|
| **Mirror folders on disk** (chosen) | Real directories and file names; browsable from Termux or Android's file manager; easy to back up; recoverable if the database is lost | Names must be sanitised; folder deletes are real filesystem operations |
| Flat ID-based blobs | Simplest consistency, no name collisions | Files meaningless without the database |

**Result:** the disk is the source of truth. SQLite is an index, re-synced by a scanner at startup and on demand.

### Thumbnails: server-side with sharp ✅
| Option | Pros | Cons |
|---|---|---|
| **sharp on the server** (chosen) | Works in any browser; covers files added outside the app; cached WebP | ~48 MB native dependency |
| Client-side canvas at upload | No native dependency | No thumbnails for HEIC on non-Safari browsers or for files added by hand |
| No thumbnails | Simplest | Grid would pull 5–10 MB originals over mobile data |

**Result:** 400 px square WebP thumbnails, generated on upload or first view and cached on disk.

### Uploads: streaming, one request per file ✅
| Option | Pros | Cons |
|---|---|---|
| **Stream each file** (chosen) | Constant memory; simple; progress bars | A dropped connection restarts that file |
| Chunked / resumable | Survives flaky mobile links | Session tracking and partial-file cleanup |

**Result:** busboy streams each file to a temp file and then renames it into place. Chunked uploads were
deferred. They were added on 16 Sep, when the Cloudflare 100 MB limit and mobile drop-outs made them
necessary ([chapter 8](08-media-and-reliability.md)).

### Browser testing: install Chromium ✅ (asked 11 Sep 23:12)
Chromium (~300 MB) was installed with apt so that headless Chromium could click through the app at
phone and desktop sizes, in light and dark mode.

## Decisions made without asking (reported afterwards)

- Plain-JavaScript backend with no build step on the phone.
- Sessions stored in SQLite; changing the password signs everyone out.
- Failed logins throttled per client IP.
- Uploads never overwrite: a clash becomes `photo (1).jpg`.
- Server listens on `127.0.0.1` only, so it's reachable only through the tunnel, which adds HTTPS.
- PDFs previewed with pdf.js, loaded on demand, because Android Chrome doesn't render PDFs inline.
- Strict Content-Security-Policy; HTML/SVG previews in a CSP sandbox.

## Architecture (v1)

```
Browser ──HTTPS──► Tailscale Funnel ──► 127.0.0.1:3000 ──► Express 5 (Node 20, in proot Debian)
                                                          ├─ /api/auth     password → session cookie
                                                          ├─ /api/upload   busboy stream → temp → rename
                                                          ├─ /api/files/:id/raw|download|thumb
                                                          ├─ /api/list, /search, /folders, /rescan
                                                          ├─ SQLite index (better-sqlite3)
                                                          └─ React SPA (frontend/dist)
Disk: ~/cloud-storage/files (real folders) · ~/cloud-storage/thumbs (WebP cache)
```

## Result (12 Sep 00:26)

| Test | Result |
|---|---|
| Backend API tests | **25 passing**: login and throttling, path-escape attempts, multi-file/oversized/interrupted/non-English uploads, name clashes, previews, thumbnails, search, disk sync, folder delete |
| 1 GB upload | Memory rose by only **~3 MB**; the download matched the upload byte for byte |
| Headless browser | **18 flows** at phone and desktop sizes, light and dark mode; no console errors, CSP violations or failed requests |

### Bugs found by the browser test and fixed before release

| Bug | Cause | Fix |
|---|---|---|
| Swiping between photos closed the preview | Chrome's own swipe-to-go-back gesture fired | `touch-action` so the app handles horizontal swipes itself |
| Long-press opened the actions sheet, which closed instantly | Chrome sends a synthetic click when a long-press is released | Ignore the click that follows a long-press |
| Folder names and the "My Drive" breadcrumb cut off on phones | Layout overflow | Layout fixes |

### Known limitations of v1
- HEIC photos show an icon instead of a thumbnail.
- Not tested yet on Funnel itself or real phone browsers (iOS Safari only emulated).
- Not in v1: rename/move, multi-select, folder upload, resumable uploads.
