# 3. Keeping It Up, and Remote Access (12–15 Sep 2026)

## Outage 1: "why everything stopped?" (12 Sep 23:44)

| | |
|---|---|
| **Symptom** | Drive and portfolio both down about 30 minutes after going live |
| **Investigation** | The phone had not rebooted. The portfolio log stopped at 23:21, and Termux services restarted fresh at 23:42. Tailscale came back by itself because it was a Termux service. |
| **Root cause** | **Android killed the Termux app.** The drive (in tmux) and portfolio had been started by hand, so they died with it and nothing restarted them. |

### Options
| Option | Result |
|---|---|
| **Run both as runit services** (chosen, recommended) | Start whenever Termux starts, restart within ~2 s if they crash, logs to files |
| Keep starting them by hand | Manual work after every Android kill or reboot |

### Fix
- Two Termux runit services, `cloud-drive` and `portfolio`, next to `tailscaled`, with logs in
  `$PREFIX/var/log/sv/<name>/current`.
- **proot doesn't forward TERM** to programs inside Debian. The `cloud-drive` run script records Node's
  PID in `node.pid`, and a `control/t` script kills that PID, so `sv restart/down` actually stop Node.
  Tested: restart, hard crash, down/up. Always exactly one process afterwards.
- **Boot script simplified.** The old Termux:Boot script also started a second Tailscale and a second
  portfolio server, which would clash with the services. It now only takes a wake lock and starts
  runit. The old version is kept as a backup.
- Wake lock enabled.
- **Phone settings for the user:** Termux battery → Unrestricted; Developer options → disable child
  process restrictions; install and open Termux:Boot once.

## Remote access from the laptop (12 Sep 23:58 – 13 Sep 00:12)

**Goal:** open phone terminals from the Windows laptop, "like an Azure VM".

### Step 1: SSH into Termux
- Termux `sshd` was already a service: port 8022, **key-only** (passwords off), bound to 127.0.0.1.
  Userspace tailscaled forwards tailnet connections to loopback, so it's reachable **only over Tailscale**.
- The laptop generated an ed25519 key.
- **Issue:** the user first sent the key's *fingerprint* instead of the public key. The full
  `id_ed25519.pub` line was requested, and its fingerprint checked against the one sent before
  authorising it.
- Connect with `ssh -p 8022 termux@<phone>` or a `Host phone` shortcut.

### Step 2: VS Code Remote-SSH failed on Termux
| | |
|---|---|
| **Symptom** | VS Code asked for the platform, then failed to connect |
| **Cause** | VS Code Server is built for glibc Linux; plain Termux uses Android's bionic libc ("remote host does not meet the prerequisites") |
| **Fix** | A **second SSH server inside Debian** (openssh-server) on port 8023, as the runit service `debian-sshd`: same key-only, Tailscale-only setup, same pidfile + `control/t` pattern. Laptop shortcut `phone-debian`. A real key login was tested end to end. |

| Host | Lands in | Use for |
|---|---|---|
| `phone` (8022) | Termux | Terminal, `sv` service commands |
| `phone-debian` (8023) | Debian | VS Code, projects, npm/git |

## Can the phone run all of this at once? (13 Sep 00:23)

Measured memory when idle:

| Always running | Memory |
|---|---|
| Portfolio (`npx serve`) | 149 MB |
| Drive (Node) | 72 MB |
| Tailscale + Funnel | 40 MB |
| Service supervisors and logs | 48 MB |
| Debian SSH + proot wrappers | 17 MB |
| **Total** | **~330 MB (~4 % of 7.4 GB)** |

Only while in use: **VS Code Server ~1.4 GB** (the biggest by far), Claude Code ~400 MB.
Note: `npx` keeps an extra npm process running, and running `serve` directly would save ~100 MB (offered).

### Issue: proot shows fake CPU numbers (13 Sep 00:40)
| | |
|---|---|
| **Symptom** | `top` showed nonsense (100 % idle while one process used 800 %), and uptime was stuck at 124 s |
| **Cause** | Android blocks apps from reading real CPU counters, so proot substitutes frozen placeholder values for `/proc/stat`, `/proc/uptime` and `/proc/loadavg` |
| **Correction** | Two earlier claims were retracted: "load 0.12" and "2 min since boot" were placeholders. The outage conclusion stood, because it rested on log timestamps. |
| **What works** | `free -h` (memory is real); `ps -eo pid,time,rss,args --sort=-time` (cumulative CPU time is real); Android's own Developer-options memory and battery screens; `adb shell top` / `dumpsys cpuinfo` over wireless debugging from the laptop |

## Outage 2: Tailscale stuck after a Wi-Fi drop (14 Sep 18:26 → 15 Sep 23:00, ~29 h)

| | |
|---|---|
| **Symptom** | "Why did both the drive and the portfolio stop?" Both public URLs failed. |
| **Investigation** | Both apps were running and answering on localhost (HTTP 200). The phone's internet worked (Google returned 200 from Debian). `tailscale status` showed the node **offline** with "network is down". The tailscaled log showed `LinkChange: all links down; pausing` at 14 Sep 18:26, when the Wi-Fi interface briefly disappeared, then health flapping for over a day. **The same thing had happened on 11 Sep.** |
| **Root cause** | **Userspace tailscaled on Termux never un-paused** after the Wi-Fi link returned |
| **Red herring** | `tailscale netcheck` inside proot reported `UDP: false`, but that was the CLI running under proot (no `/proc/net/route` access). The daemon's own log said `udp=true`. |
| **Immediate fix** | `sv restart tailscaled`. It reconnected within seconds, and both sites returned 200. |
| **Proposed** | A watchdog to detect "stuck while the internet works" and restart automatically. Built on 16 Sep ([chapter 8](08-media-and-reliability.md)). |

Diagnosis recipe recorded for next time: compare `curl 127.0.0.1:3000` / `:8000` with the public URLs,
then read `$PREFIX/var/log/tailscaled/current`.

A second, unexplained warning was seen and noted, but not investigated: `invalid packet filter ...
rejecting all packets` (Tailnet Lock is not enabled).
