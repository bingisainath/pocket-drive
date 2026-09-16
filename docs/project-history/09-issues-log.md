# 9. Issues Log

Every problem encountered, in order. "Product" issues affected the drive or its users; "Ops" issues
affected hosting or deployment; "Process" issues were mistakes in commands, tests or scripts.

| # | Date | Type | Symptom | Root cause | Resolution |
|---|---|---|---|---|---|
| 1 | 11 Sep | Product | `better-sqlite3` installed but segfaulted on load | v12+ needs Node ≥ 22; the phone has Node 20 | Pinned `better-sqlite3@^11` |
| 2 | 11 Sep | Product | iPhone HEIC photos have no thumbnail | sharp's prebuilt libvips lacks the HEVC decoder | Icon in v1; fixed 16 Sep with libheif (#40) |
| 3 | 11 Sep | Ops | UI couldn't be tested | No browser in proot Debian | Installed Chromium (with approval); headless Puppeteer tests |
| 4 | 12 Sep | Product | Swiping between photos closed the preview | Chrome's swipe-back gesture | `touch-action` so the app handles swipes |
| 5 | 12 Sep | Product | Long-press actions sheet closed instantly | Synthetic click after long-press release | Ignore the follow-up click |
| 6 | 12 Sep | Product | Folder names/breadcrumb cut off on phones | Layout overflow | Layout fixes |
| 7 | 12 Sep | Ops | GitHub device-code login expired twice | Code not entered in time; started from a background shell; no browser in Debian | User ran `gh auth login` in Termux and entered the code manually |
| 8 | 12 Sep | Process | `cd ~/cloud-drive`: no such directory | Command run in Termux, not Debian | `proot-distro login debian` first |
| 9 | 12 Sep | Process | `git remote add` without URL; push failed | Line wrapped mid-command; remote typed `orgin` | One-line commands; `git remote rename orgin origin` |
| 10 | 12 Sep | Ops | Debian `tailscale` can't reach the daemon | tailscaled runs in Termux; default socket stale | `--socket=<Termux home>/.tailscale/tailscaled.sock` |
| 11 | 12 Sep | Ops | Funnel `:443` already used by the portfolio | Shared phone | Drive on Funnel `:8443` |
| 12 | 12 Sep | Process | `npm start`: `/root/cloud-drive: Is a directory` | Command split over two lines | Short commands, one per line |
| 13 | 12 Sep | Ops | **Outage 1**: drive and portfolio down | Android killed Termux; hand-started servers | runit services with auto-restart; wake lock; boot script cleanup; battery settings |
| 14 | 12 Sep | Ops | `sv restart` didn't stop Node | proot doesn't forward TERM | Record Node PID; `control/t` kills it |
| 15 | 12 Sep | Ops | Old boot script would start duplicate Tailscale/portfolio | Legacy script | Simplified to wake lock + runit; backup kept |
| 16 | 13 Sep | Process | Fingerprint sent instead of public key | Confusion between the two | Requested the `.pub` line; verified the fingerprint matched |
| 17 | 13 Sep | Ops | VS Code Remote-SSH fails on Termux | VS Code Server needs glibc; Termux is bionic | Second sshd inside Debian on :8023 (runit `debian-sshd`) |
| 18 | 13 Sep | Ops | `top` shows impossible CPU/uptime numbers | proot fakes `/proc/stat`, `/proc/uptime` (Android blocks real counters) | Retracted two claims; use `free`, `ps` cumulative time, Android tools, `adb` |
| 19 | 13 Sep | Product | 85 photos took 11–12 min to upload | Funnel ~0.5 MB/s per connection; 2 parallel uploads | Diagnosed; fixed later by Cloudflare (#29), previews, chunked parallel uploads |
| 20 | 13 Sep | Product | Escape didn't close "⋮" sheets | Missing key handling | Fixed on the sharing branch |
| 21 | 13 Sep | Product | Upload panel covered photos after uploads | Panel positioning | Fixed on the sharing branch |
| 22 | 13 Sep | Process | `sv up cloud-drive`: unable to change to service directory | `sv` run inside Debian | Termux shell, or `SVDIR=/data/.../var/service` |
| 23 | 14–15 Sep | Ops | **Outage 2** (~29 h): both public URLs down, apps fine locally | Userspace tailscaled stayed paused after a Wi-Fi drop (also on 11 Sep) | `sv restart tailscaled`; watchdog built later (#45) |
| 24 | 15 Sep | Process | `netcheck` said UDP false | CLI running under proot | Daemon log (`udp=true`) is authoritative |
| 25 | 15 Sep | Process | Benchmark cleanup killed its own shell (exit 144) | `pkill -f` matched the pattern in its own command line | Match on process name |
| 26 | 16 Sep | Process | Quick-tunnel script hung 10 min | Bare `wait` waited for `cloudflared` | Wait on specific PIDs |
| 27 | 16 Sep | Process | **Stray public tunnel left running** | `setsid cmd &`: `$!` was setsid's PID | Found and killed by name; verified 530 |
| 28 | 16 Sep | Process | Bogus 94–285 Mbit/s via Cloudflare | Edge cache served a static file | Cache-busting query strings |
| 29 | 16 Sep | Ops | Funnel slow (2.7–9 Mbit/s, 0.5–1.8 s TTFB) | Relayed ingress + userspace TLS | Moved to Cloudflare Tunnel on own domain (18–20 Mbit/s) |
| 30 | 16 Sep | Ops | Later quick tunnels never served content | Cloudflare throttles repeated quick-tunnel creation | Named tunnel on a domain |
| 31 | 16 Sep | Ops | QUIC failed for cloudflared | UDP 7844 blocked | `protocol: http2` |
| 32 | 16 Sep | Ops | Google `redirect_uri_mismatch` on the new domain | New callback URI not registered | Added in Google Cloud Console |
| 33 | 16 Sep | Process | Made-up placeholder in an install path | Guess instead of checking | Verified path; lesson recorded |
| 34 | 16 Sep | Ops | **`.env` backup with secrets staged by `git add .`** | Untracked, not ignored | Unstaged before commit; moved out; `.env.*` ignored |
| 35 | 16 Sep | Ops | Feature branch "missing" on GitHub | Never pushed; already merged | Deleted the local branch |
| 36 | 16 Sep | Product | Viewer downloaded 5 MB originals (+ next one) | No preview size | 1600 px previews (~20× smaller) |
| 37 | 16 Sep | Process | E2E step failed after 4 parallel uploads | Test assumed upload finish order | Order-independent test |
| 38 | 16 Sep | Product | First photo open ~2 s | 343/356 previews missing; generated on demand | Background generation at startup + blurred placeholder |
| 39 | 16 Sep | Product | Placeholder looked like a colour wash | Blur too strong, full-screen cover | Centred thumbnail, 2 px blur |
| 40 | 16 Sep | Product | 36 HEIC photos unviewable | HEVC HEIC, no decoder | libheif `heif-dec` fallback |
| 41 | 16 Sep | Product | Uploads > 100 MB rejected via Cloudflare | Free-plan request body limit | 16 MB chunked uploads |
| 42 | 16 Sep | Product | Uploads restart from zero after a drop | Single-request uploads | Resumable protocol with offsets, backoff, re-add resume |
| 43 | 16 Sep | Product | Videos (HEVC, 4K/60) don't play on many browsers; large files buffer | No transcoding | Adaptive HLS 480p + ≤1080p via ffmpeg + hls.js |
| 44 | 16 Sep | Product | Sound over a black picture for HEVC originals | Browser can't decode HEVC video but plays audio, no error | Detect `videoWidth = 0` → clear message |
| 45 | 16 Sep | Ops | No automatic recovery from hung services | runit only restarts exited processes | Watchdog runit service |
| 46 | 16 Sep | Ops | No outage alerts | No external monitor | `/api/health` + UptimeRobot (free) |
| 47 | 16 Sep | Process | Branch created tracking `origin/main` | `git switch -c … origin/main` sets upstream | `git branch --unset-upstream` |
| 48 | 16 Sep | Process | `SIGSTOP` didn't freeze the test server | proot traces processes started from Debian | Busy-loop hang simulation |
| 49 | 16 Sep | Process | Verification script crashed loading SQLite | Termux Node can't load Debian-built native module | Use `/usr/bin/node` |
| 50 | 16 Sep | Ops | Two background checks lost | Claude session interrupted | Re-checked state from logs and files |
