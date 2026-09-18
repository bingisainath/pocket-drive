# 8. Media and Reliability (16 Sep 2026)

## Audit: "what is the issue in my whole setup?"

Checked on the phone:

| # | Issue found | Severity |
|---|---|---|
| 1 | **No backups at all.** ~2.2 GB (365 photos, videos) exist only on the phone; no backup tool installed, nothing scheduled | Critical |
| 2 | **36 HEIC photos can't be viewed.** All in one folder; no thumbnail or preview (sharp can't decode HEVC HEIC), and Chrome/Firefox can't show HEIC | High |
| 3 | **Videos served raw.** No transcoding; a 116 MB video can't be uploaded through Cloudflare (**100 MB request limit**) | High |
| 4 | **Single point of failure:** Android can kill Termux; Wi-Fi drops stalled Tailscale twice; no watchdog; memory 2 GB available of 7.5 GB | Medium |
| 5 | **No monitoring:** downtime only noticed when using the drive | Medium |
| 6 | **Uploads not resumable:** a dropped mobile connection restarts the file from zero | Medium |
| 7 | Security loose ends: Funnel still publicly open; Cloudflare sees plaintext at its edge; secrets in `.env` on the phone | Low |
| 8 | "Rescan" indexes hand-added files but doesn't generate their previews until restart | Low |

Battery and temperature couldn't be read: Android blocks them inside Termux without Termux:API.

## Research: how big drives and streaming sites work

| Stage | Google Drive/Photos, Dropbox, YouTube, Netflix | This drive (at audit time) |
|---|---|---|
| Upload | Chunked (~4–8 MB) and resumable; Dropbox dedupes chunks | One request per file; restarts on a drop |
| Storage | Object storage replicated across data centres; metadata in databases | Real folders on one phone + SQLite; **one copy** |
| Processing | Worker queues create every size/format once; video transcoded into many qualities | Thumbnail + preview; no video processing |
| Delivery | CDN with edge copies near viewers (Netflix Open Connect, Google Global Cache); placeholders | Cloudflare network, but private content not cached; blurred placeholder |
| Video | **Adaptive streaming (HLS/DASH):** 2–6 s segments at several qualities; the player switches to suit the connection | Raw file with range requests |
| Reliability | Redundancy, monitoring, on-call | One phone, no monitoring |

## Backups: explained, not yet chosen

The user has no cloud account; that's why the phone is used. The **3-2-1 rule** (3 copies, 2 kinds of
storage, 1 elsewhere) and ~2.2 GB of data make these fit:

| Option | Cost | Protects against | Catch |
|---|---|---|---|
| Laptop via Syncthing over Tailscale | Free | Phone lost/broken/wiped | Syncs only while the laptop is on; the copy is at home too |
| Backblaze B2 | Free ≤ 10 GB | Phone loss, fire, theft | Signup; ~$6/TB/month beyond |
| Cloudflare R2 | Free ≤ 10 GB | Same | May ask for a card to enable |
| Google Drive | Free 15 GB (5 GB without a verified phone number, since May 2026) | Same | Space shared with Gmail/Photos |
| USB/SD on the phone | ~€10 once | Corruption, accidental deletes | Not phone loss |

Suggested: laptop + one free cloud tier, encrypted with rclone crypt. **Still pending.**

## Question round (items 2–6)

| Question | Options | Chosen |
|---|---|---|
| Video playback | 720p streaming copy (recommended) / **adaptive HLS 480p+1080p** / 1080p copy | **Adaptive streaming**, the one choice that differed from the recommendation |
| Monitoring | **UptimeRobot** / Healthchecks.io / both | UptimeRobot |
| Interrupted uploads | **Auto-resume + re-add to continue** / auto only | Auto-resume + re-add |

The user also asked whether uploads over 100 MB could go through Cloudflare because it's faster.
**Yes:** Cloudflare limits each *request*, so chunking solves it (the same mechanism as resumable uploads).

## Groundwork measurements

| Check | Result |
|---|---|
| Installed (Debian apt) | `ffmpeg` 7.1.5, `libheif-examples` + `libheif-plugin-libde265` 1.19.8 |
| HEIC decode (4284×5712 tiled iPhone photo) | `heif-dec` **1.79 s** + preview **1.10 s**; orientation correct; sharp direct: metadata OK, decode fails ("bad seek") |
| Video probe | **All videos are HEVC**, six 4K @ 60 fps up to 65 Mbit/s; rotations of ±90°; some odd frame rates (`90000/1`) |
| HLS conversion speed (libx264 veryfast, 480p + 1080p) | 13 s 4K/60 fps clip: **135 s (0.10× realtime)**; 54 s 1080p clip: **127 s (0.43×)**; rotation correct (1080×1920) |

## Build (branch `feature/media-uploads-reliability`, 5 commits)

### 1. HEIC decoding (`0d17cb1`)
- If a HEIC/HEIF can't be decoded by sharp, run `heif-dec --quality 95` to a temporary JPEG (which applies rotation itself), then render thumbnail/preview as usual; the temp file is removed.
- The decoder path is configurable (`HEIF_DECODER`). The test uses a **stand-in decoder script**, because there is no HEVC *encoder* available to build a real iPhone test photo.
- **Real photo check:** thumbnail in 2.8 s, preview 1200×1600 in 3.4 s, no leftovers.

### 2. Health endpoint (`ea92f41`)
- Public `GET /api/health` → `{"status":"ok"}` when SQLite answers and free space > `MIN_FREE_MB`; otherwise 503 naming the failing part. No auth, `no-store`, nothing about files or users.

### 3. Resumable chunked uploads (`86c4a37`)
| Endpoint | Purpose |
|---|---|
| `POST /api/uploads` | Start, or find the unfinished upload for the **same user + folder + name + size + modification time** (so re-adding a file resumes it) |
| `PUT /api/uploads/:id` + `Upload-Offset` | Append one chunk (≤ 16 MB); a wrong offset returns **409 with the correct offset**; oversized returns 413; the last chunk moves the file into place |
| `GET /api/uploads/:id` | Stored offset (resync after a drop) |
| `DELETE /api/uploads/:id` | Cancel and discard |

- Partials live on the storage filesystem (atomic rename on finish), **survive restarts**, expire after **24 h**.
- The client backs off 1 → 30 s (10 attempts), asks the server how far it got, and continues; the UI shows *"Reconnecting… N % saved, will continue"*.
- Shared "commit file" code with the old single-request upload (kept for compatibility).

**Issues found while building:**
| Issue | Fix |
|---|---|
| A `.json` file's chunk would be parsed by the JSON body parser (32 KB limit) | JSON parser skips `PUT` |
| Cancel before the server replied to "start" left a partial for 24 h | Delete the session if cancelled at that moment |
| Browser test "resumed at 0 %" looked like a failure | The probe read the bar before the server's reply; re-checked the **server's actual reply**: resume offset 21 MB |

**Tests:** 58 backend tests (pieces, 409/413, re-add resume, empty and JSON files, limits, cancel,
restart survival, expiry). **Browser, throttled to 5 MB/s:** a 50 MB upload survived **6 s offline**
(showed "Reconnecting…"), and a tab closed at 20 MB **resumed at 21 MB (42 %)** in a new tab; both files
byte-identical.

### 4. Adaptive video streaming (`cefa136`)
- **Server:** ffmpeg converts each video, one at a time at **low CPU priority**, into HLS with two qualities picked **by the short side** (portrait = landscape):
  - 480p at 1 Mbit/s, plus the source size up to 1080p at up to 5 Mbit/s (bitrate scales with pixels)
  - H.264/AAC, 4 s segments, keyframes every 2 s, fps capped at 30, rotation applied
- It runs after upload, for older videos after startup (newest first), or on first play. Output is written to a temp folder and renamed when complete, and removed on delete, replace or rescan.
- `GET /api/files/:id/stream/<file>`: strict whitelist (`master.m3u8`, `low|high/index.m3u8`, `seg_N.ts`); returns 404 with `status: processing|unavailable` until ready.
- **Player:** Safari plays HLS natively; other browsers use **hls.js (light build, loaded only when a video opens)**. Until the stream exists it plays the original.

**Issues found while building:**
| Issue | Cause | Fix |
|---|---|---|
| `TS7016` build error | hls.js ships types only for its full build, not `hls.js/light` | A small `.d.ts` re-exporting the full build's types |
| **Sound over a black picture**, no error | Chromium without HEVC support plays the audio track and reports `videoWidth = 0` | On `loadedmetadata` with no picture, pause and show *"a version that plays everywhere is being prepared"* |

**Tests:** 60 backend tests (real ffmpeg: 720p/60 fps clip → 854×480 + 1280×720, H.264 + AAC, 30 fps
cap, path whitelist, delete cleanup; rendition planning). **Browser, with a real HEVC phone video in a
Chromium that can't decode HEVC:** before conversion, the clear message; after conversion (23 s for a
10 s clip), playback via hls.js at 480×640 with time advancing.

### 5. Watchdog (`c79ff29`)
A runit service in Termux (`ops/watchdog/run`). Every 60 s:

| Service | Check |
|---|---|
| cloud-drive | `/api/health` sends any HTTP response within 10 s |
| portfolio | `:8000` answers |
| cloudflared | its metrics `/ready` returns 200 (live Cloudflare connections) |
| tailscaled | daemon answers, `BackendState` Running, node online, no "network is down" |

- After **3 failures in a row:** `sv restart`; if it doesn't stop within 30 s, **kill** it (for the drive, Node's recorded PID inside proot).
- cloudflared/tailscaled only count as failing **while the phone itself is online** (a restart can't fix dead Wi-Fi).
- Skips services stopped on purpose (`sv down`) and anything up for less than 5 minutes. `DRY_RUN`/`ONCE` modes.

**Issues found while testing:**
| Issue | Cause | Fix |
|---|---|---|
| Freezing the dummy server with `SIGSTOP` did nothing | Processes started from the Debian shell run under proot, which traces them and swallows stop signals | Simulated a real hang with a busy loop on `/hang` |
| Exit 144 again | `pkill -f` pattern matched its own shell | Test moved into a script file; leftovers killed by process name |
| Install path in README was a placeholder | Guessed path | Verified Debian's rootfs path as seen from Termux |

**Results (dummy runit service):**
| Scenario | Result |
|---|---|
| Hung server | Detected after 2 checks, restarted, answering again **27 s** later |
| Stopped on purpose | Ignored (0 log lines) |
| Hung + ignoring TERM | *"did not stop within 30 s, killing it"*, then restarted and answering |
| Dry run against live services | All four healthy |

README updated: features, settings (`UPLOAD_CHUNK_MB`, `FFMPEG`/`FFPROBE`, `HEIF_DECODER`), watchdog
install, UptimeRobot, troubleshooting.

## Deployment and live verification (16 Sep 22:46–23:05)

| Check | Result |
|---|---|
| Version | `main` at `c79ff29`, pushed; live bundle = built bundle |
| Services | drive, portfolio, cloudflared, tailscaled, **watchdog** all running; watchdog logged no failures |
| Health | `{"status":"ok"}` via Cloudflare in 0.25 s, via Funnel in 1.06 s |
| **HEIC** | `Generated 72 missing thumbnails/previews in 235s` = **all 36 photos** × 2; preview via Cloudflare 203 KB in 1.0 s |
| **Video** | Converted video serves 1080×1440 + 480×640; a 1.7 MB 1080p segment in 1.1 s; unconverted ones return "processing" |
| **110 MB upload via Cloudflare** | **7 × 16 MB chunks, 27 s (34 Mbit/s), byte-identical**; this was impossible before |
| Conversion queue | 4 of 15 videos done at 22:53 (a new video had been uploaded); the drive stayed responsive meanwhile (health 0.25 s) |

The live test's temporary session and folder were deleted, with no partial uploads left behind.
A verification script initially crashed because Termux's Node (first on PATH) can't load the
Debian-built `better-sqlite3`. `/usr/bin/node` was used instead. The drive itself was unaffected.

## UptimeRobot: free or trial?
The free plan is **permanent, not a trial**: 50 monitors, 5-minute checks, email alerts (SMS/voice need
paid credits), 3 months of history, **no credit card**, no automatic upgrade. It's intended for
personal, non-commercial use. Monitor: `https://drive.bingisainath.com/api/health` (plus optionally the
portfolio).
