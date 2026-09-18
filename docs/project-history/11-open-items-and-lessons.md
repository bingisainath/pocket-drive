# 11. Open Items and Lessons Learned

## Open items (as of 16 Sep 2026)

| Item | Why it matters | Next step |
|---|---|---|
| **Backups** | All data exists in one place: the phone | Choose: laptop via Syncthing + a free 10 GB tier (B2/R2), encrypted with rclone crypt |
| **UptimeRobot signup** | Alerts depend on it | Monitor `https://drive.bingisainath.com/api/health` (and the portfolio), 5-minute interval |
| **Termux battery → Unrestricted** | Android can still kill Termux; the watchdog can't prevent that | Android settings |
| **Turn off Funnel** (~23 Sep) | Second public entry point; slower | `tailscale funnel` off; remove the ts.net origin from `PUBLIC_ORIGINS` |
| Video conversion speed | 4K/60 fps converts at ~0.1× realtime on CPU | Try Android hardware encoding (MediaCodec via Termux ffmpeg) |
| Rescan doesn't generate previews/streams | Hand-added files wait until restart or first view | Trigger background generation after a rescan |
| Cloudflare free plan and large media | Terms are a grey area for serving lots of video | Keep an eye on it; a VPS relay is the fallback |
| Cloudflare decrypts at its edge | Privacy trade-off for speed | Use Tailscale directly for very sensitive files |
| `www` duplicates the apex | Minor SEO/duplication | Cloudflare Redirect Rule |
| Unexplained "invalid packet filter" Tailscale warning | May affect tailnet-direct access | Investigate if tailnet access is needed |
| Portfolio via `npx serve` | ~100 MB extra memory | Run `serve` directly |
| Not built yet | — | Rename/move, multi-select, folder upload, dedup, quotas, EXIF/GPS stripping, expiring links |

## Known limits of the design
- **The phone's uplink (~24.5 Mbit/s) is a ceiling** for everything leaving the phone. No tunnel can
  beat it; only sending fewer bytes helps.
- **~0.5 s per request** comes from mobile-broadband latency plus the tunnel round trip.
- **CPU-bound media processing** on a phone: photos ~1–3 s each, video 2–10 minutes per minute.
- **Single device:** power, heat, theft or Android policy can take everything offline.

## Lessons learned

### Engineering
1. **Measure every hop before optimising.** The "slow drive" turned out to be the tunnel (10× below the
   uplink), not the server (sub-second) or the disk. And the remaining ~2 s was preview generation,
   not the network.
2. **Send fewer bytes before buying faster pipes.** Previews cut data 10–21×; switching tunnels gave 2–3×.
3. **Revisit decisions when data contradicts them.** "Generate previews on first view" looked lighter,
   but measured first opens of ~2 s showed pre-generating was right.
4. **Cache-bust benchmarks.** CDN edge caches produced impossible numbers until each request was unique.
5. **Supervise everything, and watch for "running but stuck".** runit fixed crashes; a hung-but-alive
   tailscaled needed a health-checking watchdog.
6. **Chunk uploads below proxy limits.** It fixes size caps and dropped connections in one mechanism.
7. **Transcode phone video.** Phones record HEVC, which many desktop browsers can't decode, and some
   play the sound over a black picture instead of failing.
8. **Detect silent failures in the UI.** "No error, no picture" needed an explicit check.

### Android / Termux / proot specifics
- proot **doesn't forward TERM** to programs inside Debian: record PIDs and stop them directly.
- proot **fakes CPU/uptime counters**; memory numbers are real.
- proot **swallows `SIGSTOP`** for processes it traces: simulate hangs another way.
- `sv` and `$PREFIX` belong to Termux; from Debian use full paths.
- Termux's Node and Debian's Node are different builds; native modules only load in the one that built them.
- Userspace tailscaled can stay paused after a Wi-Fi drop; restart it.
- VS Code Remote-SSH needs glibc: SSH into Debian, not Termux.

### Shell and scripting
- `pkill -f <pattern>` can kill the very shell running it when the pattern appears in its own command line.
- `setsid cmd &` makes `$!` the PID of `setsid`, not of `cmd`.
- A bare `wait` waits for *all* background jobs, including long-running daemons.
- `git switch -c new origin/main` sets `origin/main` as upstream: a plain `git push` could push to `main`.
- `git add .` picks up untracked secrets: name files explicitly, and ignore backup patterns.

### Process
- **Ask about architecture, decide details.** Batched question rounds with a recommendation and
  trade-offs made decisions fast and explicit.
- **Develop in a worktree, test on a throwaway server, then deploy.** The live drive was never broken
  by unfinished code.
- **Verify, don't guess.** A made-up install path and an unverified probe result were both caught only
  because they were double-checked.
