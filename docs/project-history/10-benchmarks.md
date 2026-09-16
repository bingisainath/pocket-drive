# 10. Benchmarks

Measured on the phone (Android, Termux + proot Debian, arm64, 9 cores, 7.5 GB RAM) over its Wi-Fi
router, a 5G mobile-broadband CPE. Tests "via Cloudflare" or "via Funnel" from the phone itself loop out
to the internet and back, so they are **capped by the phone's ~24.5 Mbit/s uplink**. Remote devices
uploading to the phone are capped by *their* uplink and the phone's ~120 Mbit/s downlink instead.

## Baseline: the phone and its link (15 Sep)

| Measurement | Result |
|---|---|
| Internet download | 120 Mbit/s |
| Internet upload | **24.5 Mbit/s** (hard ceiling for anything leaving the phone) |
| TCP connect to Cloudflare / Google | 117–147 ms / 100 ms |
| Disk write (200 MB, fsync) | 216 MB/s |
| Disk read | 2.9 GB/s |
| Idle memory of all services | ~330 MB of 7.4 GB (13 Sep) |

## The server alone (localhost, throwaway instance)

| Operation | Result |
|---|---|
| Upload a 4.9 MB photo | 0.10–0.13 s |
| Upload a 4.2 MB photo (live server) | 0.25 s (142 Mbit/s) |
| Download a 5 MB photo | 0.09–0.18 s |
| First thumbnail (400 px) | 0.25–0.40 s |
| Cached thumbnail | 12–27 ms |
| 1 GB upload, memory increase (v1) | ~3 MB |
| Real app transfers (13 Sep) | 18–37 MB/s |

## Tunnel throughput and latency

### Funnel, real uploads (13 Sep)
| | Result |
|---|---|
| Real upload speed of 85 photos | 0.33–0.59 MB/s (≈ 11–12 min for ~380 MB) |
| Parallel transfers 1 / 2 / 6 | 0.55 / 0.98 / 1.69 MB/s |

### Same 1.37 MB file, three paths
| Path | Single stream | TTFB | 6 parallel | Phone CPU |
|---|---|---|---|---|
| Localhost | 270–790 Mbit/s | 6–18 ms | — | — |
| Funnel (15 Sep) | 2.7–8.7 Mbit/s | 0.5–1.8 s | 11.4 Mbit/s | tailscaled 70 % |
| Funnel (16 Sep, re-test) | 6.4–9.1 Mbit/s | 0.44–0.55 s | 10.5–18.2 Mbit/s | — |
| **Cloudflare quick tunnel** | **18–20 Mbit/s** | **0.31 s** | (cache-busted run invalid) | cloudflared 27 % |
| **Cloudflare named tunnel, own domain** | 1.07–1.32 s per file (8–10 Mbit/s) | 0.83–1.03 s | **33.6 Mbit/s** | — |
| Funnel at the same time | 2.06–2.19 s per file (5 Mbit/s) | 0.62 s | 19.4 Mbit/s | — |

## Opening photos (live domain)

| Scenario | Cloudflare | Tailscale Funnel |
|---|---|---|
| **Before previews:** original 4 MB | 3.15 s | 6.20 s |
| **Before previews:** original 12 MB | 7.26 s | 12.32 s |
| Preview, first open (generated on demand) | ~2.0 s | slower |
| Preview generation alone | 1.2–1.9 s | — |
| Preview, second open (cached) | 0.62–0.81 s | 0.68–1.38 s |
| **After background generation**: 5 MB photos (5 samples) | **0.69 s avg** (0.57–0.88) | 1.16 s avg |
| **After background generation**: 12 MB photos (4 samples) | **0.59 s avg** (0.53–0.65) | 1.06 s avg |
| Grid thumbnail | 0.48–0.56 s | 0.69–1.12 s |
| Open + preload next simultaneously (worst case) | 1.0–2.9 s | — |

| Data sent per photo opened | Size |
|---|---|
| Original (before) | 4.2–5.1 MB (up to 12 MB) |
| Preview (after), measured samples | 109 KB · 121 KB · 229 KB · 244 KB · 311 KB avg (5 MB photos) · 434–482 KB (12 MB photos) |
| Reduction | **~10–21×** |

## Preview generation settings (per photo)

| Setting | 4.2 MB photo | 11.6 MB photo |
|---|---|---|
| WebP q80, 1 thread (used) | 1.88 s / 109 KB | 1.34 s / 434 KB |
| WebP effort 1 | 1.87 s / 116 KB | 1.02 s / 454 KB |
| WebP, 4 threads | 2.08 s | 2.79 s |
| JPEG mozjpeg q82 | 1.66 s / 131 KB | 1.21 s / 409 KB |
| JPEG plain q82 | 1.27 s / 174 KB | 0.84 s / 503 KB |
| Decode + resize only | 1.45 s | 0.55 s |
| Background job, live library | 307 images in 446 s; 72 HEIC images in 235 s | |
| HEIC (4284×5712): `heif-dec` + preview | 1.79 s + 1.10 s (2.8 s thumb / 3.4 s preview via app) | |

## Uploads

| Scenario | Result |
|---|---|
| 4.2 MB via Cloudflare | 2.84–2.93 s (~12 Mbit/s) |
| 4.2 MB via Funnel | 4.67–5.53 s (6.3–7.5 Mbit/s) |
| 4 × 4.2 MB at once via Cloudflare | 11.7 s, 12.0 Mbit/s combined |
| **110 MB chunked via Cloudflare (after)** | **27 s, 34.4 Mbit/s, 7 × 16 MB chunks, identical** |
| > 100 MB single request via Cloudflare (before) | Rejected (free-plan limit) |
| 50 MB, 6 s offline mid-upload (browser, 5 MB/s throttle) | Resumed automatically; identical |
| 50 MB, tab closed at 20 MB, re-added | Resumed at 21 MB (42 %); identical |

## Video (HLS conversion on the phone, libx264 veryfast, 480p + 1080p)

| Source | Duration | Time | Speed |
|---|---|---|---|
| 4K HEVC, 60 fps, 63 Mbit/s | 13 s | 135 s (123 s live) | 0.10× realtime |
| 1080p HEVC, 30 fps, 17 Mbit/s | 54 s | 127 s | 0.43× |
| 1080×1440 HEVC | 10 s | 23 s | 0.43× |
| 4K HEVC, 30 fps | 9 s | 56 s (live) | 0.16× |
| 1080×1440 HEVC, short clips | 1–3 s | 3–5 s (live) | — |
| Output size (13 s 4K clip / 54 s 1080p clip) | | 11 MB / 40 MB (both qualities) | |
| Streaming via Cloudflare | | master + playlist + 1.7 MB 1080p segment in 1.1 s | |
| Drive health check during conversion | | 0.25 s | |

## Reliability

| Scenario | Before | After |
|---|---|---|
| Android kills Termux | Sites down until restarted by hand | runit restarts services when Termux starts (~2 s after a crash) |
| Tailscale stuck after a Wi-Fi drop | ~29 h outage until noticed | Watchdog restart after 3 failed 60 s checks (~3–4 min) |
| Hung server (dummy test) | — | Restarted and answering 27 s after hanging (test used 2 s checks) |
| Hung server ignoring TERM | — | Killed after 30 s, restarted |
| Outage alerting | None | UptimeRobot, 5-minute checks |

## Tests

| Stage | Backend tests | Browser suite |
|---|---|---|
| v1 (12 Sep) | 25 | 18 flows |
| Sharing (13 Sep) | 50 | full suite (owner, friend, uninvited) |
| Previews (16 Sep) | 52 → 53 | full suite |
| Media & reliability (16 Sep) | **60** | **19 steps**, plus dedicated resume, offline, video and watchdog checks |
