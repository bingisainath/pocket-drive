# Pocket Drive — Project History

How a self-hosted "Google Drive" running on an Android phone was built, taken live, debugged and
optimised between **11 and 16 September 2026**. It records every decision with the options we
weighed, every issue and how it was fixed, and before/after measurements.

All times are UTC. Measurements were taken on the phone itself unless stated otherwise.

## At a glance

| | |
|---|---|
| **What** | A minimal, self-hosted Google Drive. You can upload, browse, preview, stream and share photos, videos and files from any device. |
| **Where it runs** | An Android phone: Termux → proot-distro Debian 13 (arm64), Node.js 20 |
| **Live at** | `https://drive.bingisainath.com` (drive) and `https://bingisainath.com` (portfolio), via Cloudflare Tunnel |
| **Repo** | Private GitHub repo `pocket-drive` |
| **Stack** | React 19, TypeScript, Vite, Tailwind 4, pdf.js, hls.js · Node 20, Express 5, SQLite (better-sqlite3), sharp/libvips, busboy, ffmpeg, libheif · Google OAuth 2.0/OIDC · Cloudflare Tunnel + DNS, Tailscale Funnel, runit · node:test, Puppeteer |
| **Size** | ~5,000 lines of app code, 60 API tests, 19-step browser test suite |

## Headline results

| Metric | Before | After |
|---|---|---|
| Opening a photo in the viewer (live) | 6.2 s via Funnel / 3.2 s via Cloudflare (4 MB original) | **0.6–0.7 s** (110–480 KB preview, Cloudflare) |
| Data per photo opened | 5.0 MB | **~0.24 MB** (~20× less) |
| Download throughput through the public tunnel (single stream) | 2.7–9 Mbit/s (Funnel) | **18–20 Mbit/s** (Cloudflare) |
| 12 MB original download | 12.3 s (Funnel) | **7.3 s** (Cloudflare) |
| Upload throughput through the public tunnel | 0.33–0.59 MB/s real uploads via Funnel (85 photos took 11–12 min) | 4.2 MB photo in **2.9 s** (~12 Mbit/s); 110 MB file at **34 Mbit/s** via Cloudflare |
| Files over 100 MB via the public domain | Rejected by Cloudflare | **Work**: sent in 16 MB chunks |
| Upload after a dropped connection | Restarts from 0 | **Resumes** where it stopped, even after closing the tab |
| iPhone HEIC photos (36) | No thumbnail, can't be viewed | **Thumbnails + previews** |
| Phone videos (HEVC, up to 4K/60 fps) | Raw file; sound over a black picture in Chrome on PCs and Firefox | **Adaptive HLS**, 480p + up to 1080p, plays everywhere |
| Recovery when a service hangs | Manual (Tailscale outage lasted ~29 h) | **Watchdog** restarts a hung service in about 3 minutes |
| Outage alerting | None | Public `/api/health` for UptimeRobot |

## Documents

| # | Document | Covers |
|---|---|---|
| 1 | [v1: building the app](01-v1-build.md) | Requirements, first design decisions, native-module problems on Android, browser-testing bugs |
| 2 | [GitHub and going live](02-github-and-going-live.md) | GitHub auth without a browser, repo re-creation, Tailscale Funnel, going live |
| 3 | [Keeping it up, and remote access](03-uptime-and-remote-access.md) | Both outages, runit services, SSH and VS Code from the laptop, resource usage, proot's fake CPU numbers |
| 4 | [Sharing and Google sign-in](04-sharing-and-google-sign-in.md) | Permission model, security concepts, OAuth setup, deploying it |
| 5 | [Finding the speed bottleneck](05-speed-investigation.md) | Slow uploads, measuring every hop, why Funnel was the bottleneck |
| 6 | [Tunnel alternatives, domain and Cloudflare](06-cloudflare-and-domain.md) | Options compared, Cloudflare benchmarks, why not port forwarding, domain choice, tunnel setup, HTTPS |
| 7 | [Photo previews](07-photo-previews.md) | Preview images, zoom-to-original, parallel uploads, background generation, placeholders |
| 8 | [Media and reliability](08-media-and-reliability.md) | Audit, how big drives and streaming sites work, HEIC, adaptive video, resumable uploads, health checks, watchdog |
| 9 | [Issues log](09-issues-log.md) | Every problem hit, its root cause and fix, in one table |
| 10 | [Benchmarks](10-benchmarks.md) | Every measurement, grouped by topic |
| 11 | [Open items and lessons learned](11-open-items-and-lessons.md) | What's still to do, known limits, and engineering lessons |
| 12 | [The Android app](12-android-app.md) | Native app: background uploads, push, camera backup, app lock, release prep, and the bugs fixed along the way |

## Timeline

| When (2026) | Milestone | Commit |
|---|---|---|
| 11 Sep 22:12 | Project requested; design questions answered | — |
| 12 Sep 00:26 | v1 complete: 25 API tests, 1 GB upload test, 18 browser flows | `b326edb` |
| 12 Sep 11:23 | Pushed to private GitHub repo (re-created by hand 22:56) | — |
| 12 Sep 23:13 | **Live** via Tailscale Funnel on `:8443` | — |
| 12 Sep 23:52 | Outage 1 (Android killed Termux) fixed with runit services | — |
| 13 Sep 00:12 | SSH and VS Code Remote-SSH from the laptop, over Tailscale | — |
| 13 Sep 15:25 | Upload slowness measured: Funnel caps ~0.5 MB/s per connection | — |
| 13 Sep 17:10 | Folder sharing, roles, Google sign-in, activity log | `4d3e583` `8f0d677` `98b5cd3` |
| 14 Sep 18:26 | Outage 2 begins: tailscaled stuck after a Wi-Fi drop | — |
| 15 Sep 23:00 | Outage 2 fixed by restarting tailscaled; bottleneck analysis | — |
| 16 Sep 01:48 | Cloudflare quick-tunnel benchmark: ~2–3× faster than Funnel | — |
| 16 Sep 16:22 | Domain `bingisainath.com` registered | — |
| 16 Sep 16:27 | **Live on Cloudflare Tunnel** (drive, portfolio) | — |
| 16 Sep 16:53 | `.env` backups ignored after an accidental `git add .` | `6bbba54` |
| 16 Sep 17:20 | Photo previews + 4 parallel uploads deployed | `40de129` |
| 16 Sep 17:44 | Background preview generation + blurred placeholder deployed | `08a830a` |
| 16 Sep 22:46 | HEIC, health endpoint, resumable uploads, adaptive video, watchdog deployed | `0d17cb1` `ea92f41` `86c4a37` `cefa136` `c79ff29` |

## How we worked

- **Ask before architecture decisions, decide details myself.** The user asked for this at the start. Every major fork was a short question round with a recommended option and its trade-offs. The user usually picked the recommendation; once they chose differently: adaptive streaming over a single 720p copy.
- **Measure before optimising.** Every speed change was preceded by a measurement of where the time actually went, and followed by a re-measurement.
- **Separate development from the live system.** The live service runs from `/root/cloud-drive` on `main`. Changes are built in a git worktree (`/root/cloud-drive-dev`) on a feature branch, tested against throwaway server instances on another port, and only then merged and deployed.
- **Test in a real browser.** Headless Chromium drives the UI at phone and desktop sizes. It caught several bugs that unit tests could not.
