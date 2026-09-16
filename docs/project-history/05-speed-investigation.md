# 5. Finding the Speed Bottleneck (13 & 15 Sep 2026)

## Part 1: "85 images take 11–12 minutes to upload" (13 Sep 15:21)

### Method
The drive's database already recorded each file's size and the moment its upload finished, so the
**real upload speed** could be read without touching files. Separately, the same file was downloaded
locally and through the public Funnel address.

### Findings
| Measurement | Value |
|---|---|
| Real uploads through Funnel | **0.33–0.59 MB/s**. 85 photos × 4.5 MB avg ≈ 380 MB, so ~12 min |
| The app itself, on the phone | **18–37 MB/s** (~30× faster) |
| Funnel, per connection | capped at ~0.5 MB/s (relayed through Tailscale's servers) |

| Simultaneous transfers over Funnel | Total speed |
|---|---|
| 1 | 0.55 MB/s |
| 2 (what the app did then) | 0.98 MB/s |
| 6 | **1.69 MB/s** |

### Suggestions at the time
1. Upload from the phone itself via `http://127.0.0.1:3000` (~30× faster).
2. From tailnet devices use `http://tailscale-termux:3000` (direct WireGuard, not Funnel's relay).
3. Code changes: more parallel uploads, an optional reduce-photo-size switch, resumable uploads for big videos.

The user chose to build sharing first ([chapter 4](04-sharing-and-google-sign-in.md)).

## Part 2: Where exactly is the bottleneck? (15 Sep, after outage 2)

The request: *"is it the Tailscale server side, the phone, or the network?"* plus an architecture overview.

### Every hop measured

| Hop | Test | Result |
|---|---|---|
| **Drive server alone** | Throwaway instance on :3100 with 5 real photos | 4.9 MB upload **0.10–0.13 s**; 5 MB download **0.09–0.18 s**; first thumbnail **0.25–0.40 s**; cached thumbnail **12–27 ms** |
| **Disk** | `dd` inside proot | write 216 MB/s (fsync), read 2.9 GB/s |
| **Phone's internet link** | Cloudflare speed endpoints | **120 Mbit/s down / 24.5 Mbit/s up**, 117 ms TCP connect |
| **Local static file** | 1.37 MB portfolio JS, localhost | 270–790 Mbit/s, 6–18 ms to first byte |
| **Same file via Funnel** | public URL | **2.7–8.7 Mbit/s, 0.5–1.8 s to first byte** |
| **Funnel, 6 in parallel** | same file | 11.4 Mbit/s combined (2.0–3.6 per stream); **tailscaled at 70 % of a CPU core** |

### Conclusion
- **Not the server** (sub-second for everything) and **not the disk**.
- **The phone's 24.5 Mbit/s uplink is a hard ceiling:** a 5 MB photo can never leave the phone in under ~1.7 s.
- **Funnel was the bottleneck:** ~10× below the uplink ceiling, with high latency. Every request goes to
  Tailscale's public ingress, is relayed to the phone over the tailnet, and is decrypted by userspace
  tailscaled (a software network stack) on the phone's CPU.
- **The app made it worse:** the photo viewer loaded full 5 MB originals.

### Architecture overview at this point
```
Browser ──HTTPS──► Tailscale Funnel ingress (Tailscale's cloud)   ◄── bottleneck
                     │ tailnet tunnel (possibly relayed)
                     ▼
Android phone ─ Termux ─ runit
   ├─ tailscaled (userspace): TLS, :443 → :8000 portfolio, :8443 → :3000 drive
   └─ cloud-drive (proot Debian): Express, React SPA, auth, uploads, thumbs, SQLite, disk
```

### Improvement options proposed
1. **Smaller preview images** in the viewer (recommended; helps on every path).
2. **Tailnet-direct access** for the owner's own devices.
3. Keep Funnel only for sharing with people without Tailscale.

The user asked for cheaper or faster public options first ([chapter 6](06-cloudflare-and-domain.md)),
and deliberately postponed code changes: *"first let's do the research, next we will proceed with the
proper implementation."*
