# 6. Tunnel Alternatives, Domain and Cloudflare (16 Sep 2026)

## Options researched

| Option | Cost | Findings |
|---|---|---|
| **Tailscale Funnel** (current) | Free | Relayed; DERP relays throttle throughput; relayed connections can lose 80–95 % of bandwidth; Funnel can't use custom relays |
| **Cloudflare Tunnel** | Free (named tunnel needs a domain, ~€10/yr) | Global edge; `cloudflared` already installed in Termux; free plan caps request bodies at **100 MB**; serving large media on the free plan is a terms-of-service grey area |
| **ngrok** | Free tier: 1 GB/month bandwidth, random URLs | Too little bandwidth for photos/videos (`ngrok` also already installed) |
| Pinggy / localhost.run / localtunnel | Free, random URLs, session limits | Fine for demos, not for a permanent drive |
| **Cheap VPS as relay** (WireGuard + Caddy, or frp/rathole) | Hetzner CX22 ~€4.35/mo (+€0.50 IPv4); Oracle Always Free ARM | Full speed, static IP, no ToS grey area; the most setup; still capped by the phone's uplink |
| **Direct port forwarding** | Free | Theoretically fastest; see the analysis below |

## Cloudflare quick-tunnel benchmark (16 Sep 01:48)

Same 1.37 MB file, measured minutes apart, **cache-busted** so it really came through the tunnel.

| Path | Single stream | Time to first byte | CPU on the phone |
|---|---|---|---|
| Localhost | 270–790 Mbit/s | 6–18 ms | — |
| Tailscale Funnel | **6.4–9.1 Mbit/s** | 0.44–0.55 s | tailscaled ~70 % of a core |
| **Cloudflare quick tunnel** | **18–20 Mbit/s** | **0.31 s** (Dublin edge) | cloudflared **~27 %** |

**Result:** Cloudflare was **2–3× faster** at a third of the CPU, reaching ~75–80 % of the phone's
24.5 Mbit/s uplink ceiling. The key reading carried `cf-cache-status: DYNAMIC` (not cached).

### Issues hit while benchmarking (all in the test scripts, not the product)
| Issue | Cause | Fix |
|---|---|---|
| First Cloudflare readings showed 0 bytes | Requests sent while the new tunnel was still coming up | Warm up until the full file arrives |
| Script hung for 10 minutes | A bare `wait` waited for *every* background job, including `cloudflared`, which never exits | `wait` on specific curl PIDs |
| Commands died with **exit 144** (three times) | `pkill -f <pattern>` matched the shell whose own command line contained the pattern | Match on process name (`comm`), or put scripts in files |
| **A public tunnel was left running** | `setsid cmd &` makes `$!` the PID of `setsid`, which exits at once, so `kill $!` did nothing | Found and killed; verified the URL returned 530 afterwards |
| **94–285 Mbit/s** "results" | Cloudflare's edge served a **cached** copy of the static JS (impossible over a 24.5 Mbit/s uplink) | Unique `?cb=` query strings |
| Later quick tunnels registered but never served | Cloudflare throttles repeated quick-tunnel creation | Stopped testing; used the earlier valid data |
| QUIC connection failed | UDP port 7844 blocked on this network | cloudflared falls back to HTTP/2 automatically |

## "Why not direct port forwarding if it's fastest?" (option 7)

Checked on this phone's network:

| Evidence | Finding |
|---|---|
| IP registry (RDAP) | Address block registered to **eir Mobile Broadband** (Irish mobile carrier) |
| Router API | A **Huawei 5G CPE**, a mobile broadband router |
| Tailscale's log history | The public IP **changed at least 3 times** in a week |
| UPnP / NAT-PMP / PCP | **Not available** (`portmap=` empty in every sample) |
| Carrier NAT (CGNAT) | **Unproven either way**: the router doesn't expose its WAN IP, an external probe was inconclusive, and there's no traceroute in proot |

**Reasons it was not recommended:**
1. **Small gain:** the uplink caps everything at 24.5 Mbit/s. Cloudflare already reached 18–20. Direct would save ~20 % (a 5 MB photo in 1.7 s instead of 2.0 s), while previews save 90 %+.
2. **Dynamic IP:** needs dynamic DNS; reconnects break uploads.
3. **Possible carrier NAT:** port forwarding might simply be impossible.
4. **Certificates:** Let's Encrypt HTTP challenges need port 80 reachable; DNS challenges need API tokens on the phone.
5. **Security:** it would put the phone's Node process directly on the internet. The portfolio's logs already showed scanners probing `/.env`, `/license.txt` and similar paths, even behind an ingress.
6. **Carrier terms** often forbid servers and block inbound 80/443.
7. IPv6 is a partial exception, but it rotates, and many client networks are IPv4-only.

## Domain

### Cost question: "€10 every year, or a cheap first year?"
| Registrar | .com first year | Renewal |
|---|---|---|
| **Cloudflare Registrar** | ~$10.50 (at cost; the user saw ~€10) | **same** (at cost) |
| Porkbun | ~$11.80 | same |
| Namecheap | ~$6–7 promo | ~$15–19 |
| GoDaddy | ~$9.99 | ~$21.99 |

At-cost prices still follow the registry: Verisign raises the .com wholesale price **7 % on 1 Nov 2026**
($10.26 → $10.97), and may raise it up to 7 % a year for three more years (~$13.42).

### Name choice
Availability checked with RDAP: `pocketdrive.com`, `pocketdrive.app`, `mypocketdrive.com`, `sainath.com`
and `sainath.dev` were **taken**. Personal-name domains were free. **`bingisainath.com`** was recommended:
one domain covers the portfolio at the apex and the drive at `drive.`, matches the GitHub username,
and never goes stale if the app is renamed. Subdomains are free, and the free Universal SSL covers one
subdomain level.

**Registered 16 Sep 16:22 on Cloudflare** (~€10/yr), nameservers on Cloudflare.

## Tunnel setup (16 Sep 16:26–16:27)

### Question round
| Question | Chosen |
|---|---|
| Move the portfolio too? | **Yes**: `bingisainath.com` + `www`; drive at `drive.bingisainath.com` |
| Funnel during the switch? | **Keep both for a week** as a fallback |
| How to manage the tunnel? | **Config file on the phone** (locally managed; no Zero Trust dashboard signup) |

### Steps
1. `cloudflared tunnel login`: the user opened the URL on the phone and authorised the domain; certificate saved in the Termux home.
2. `cloudflared tunnel create phone`.
3. `config.yml` ingress: `drive.bingisainath.com → 127.0.0.1:3000`; apex and `www → 127.0.0.1:8000`; `protocol: http2` (QUIC is blocked here).
4. `cloudflared tunnel route dns` for all three hostnames (CNAMEs created automatically).
5. A runit service `cloudflared`, which connected to the Amsterdam and Dublin edges.
6. Drive `.env`: `PUBLIC_ORIGINS` gained `https://drive.bingisainath.com`, keeping the Funnel origin (backup of `.env` taken).

All five public URLs returned **200** at 16:27.

### Issue: Google `redirect_uri_mismatch`
| | |
|---|---|
| **Check** | The app sent exactly `https://drive.bingisainath.com/api/auth/google/callback` (read from the live redirect) |
| **Cause** | The new URI had not yet been added to the OAuth client in Google Cloud Console |
| **Fix** | Add it under *Authorised redirect URIs* (not JavaScript origins), keep the old one, Save; allow minutes for propagation. The user confirmed it worked. |

## HTTPS: which certificates?

| Address | Certificate | Covers | Managed by |
|---|---|---|---|
| bingisainath.com, www, drive | Let's Encrypt | `bingisainath.com` + `*.bingisainath.com` | Cloudflare, auto-renewed |
| Funnel address | Let's Encrypt | that hostname | Tailscale, auto-renewed |

Request path: browser → **TLS** → Cloudflare edge → **TLS tunnel started by the phone** → cloudflared →
plain HTTP on `127.0.0.1` (never leaves the phone).

**Trade-off noted:** Cloudflare terminates TLS at its edge, so it can technically see the traffic.
Funnel passes TLS through to the phone. The speed was judged worth it for a personal drive.

## After: new domain vs Funnel (16 Sep)
| | One 1.37 MB download (cache-busted) | 6 in parallel |
|---|---|---|
| **Cloudflare (`bingisainath.com`)** | **1.07–1.32 s** | **33.6 Mbit/s** |
| Funnel | 2.06–2.19 s | 19.4 Mbit/s |

## Repository housekeeping the same day
| Issue | Resolution |
|---|---|
| "Why are there two folders?" | `cloud-drive-dev` is a git worktree for feature work, so the live folder never runs unfinished code |
| **`git add .` staged `backend/.env.bak-…`** (contains the OAuth secret and password hash) | Caught before commit: unstaged, moved out of the repo, and `.env.*` (except `.env.example`) added to `.gitignore` (`6bbba54`) |
| "Why is `feature/sharing-google-auth` not on GitHub?" | It was never pushed; its commits were already on `main`, so the branch was deleted |
| New feature branch created **tracking `origin/main`** by accident | Upstream unset, so a plain `git push` couldn't push to `main` |
