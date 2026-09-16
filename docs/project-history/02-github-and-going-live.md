# 2. GitHub and Going Live (12 Sep 2026)

## Setting up GitHub

**Question round (12 Sep 00:38):** a private repo (recommended; no secrets are in the code, since the
password hash lives in the git-ignored `backend/.env`), named `pocket-drive`. The browser test was moved
into the repo as `e2e/` (`npm run test:e2e`). The first commit had 58 files, with no `.env`,
`node_modules`, build output or screenshots.

### Issue: GitHub CLI login kept expiring
| | |
|---|---|
| **Symptom** | `gh auth login` device codes expired twice; nothing was pushed |
| **Cause** | The device-code flow was started from Claude's background shell, and the code wasn't entered in time. The session also ended while waiting. There's no browser inside proot Debian to open the URL automatically. |
| **Fix** | The user ran `gh auth login` in their own Termux window and typed the code at `github.com/login/device` by hand. The "Failed opening a web browser" message is expected and harmless. |
| **Note** | `gh` stores the token in plain text (`~/.config/gh/hosts.yml`), as usual on Linux without a keychain. It can be revoked in GitHub settings. |

The repo was created and pushed at 11:23.

### Issue: the GitHub repo was deleted, and re-pushing by hand hit three slips
The user deleted the GitHub repo (21:51) and asked for manual commands. The local repo and commit were
intact, so only a new empty repo and a push were needed.

| Slip | What happened | Fix |
|---|---|---|
| `cd ~/cloud-drive: No such file or directory` | Command run in plain Termux, not inside Debian. The project lives in Debian's filesystem. | `proot-distro login debian` first |
| `git remote add origin` with no URL | A long command wrapped onto a second line and ran unfinished | Type long commands on one line; Termux wraps them itself |
| `fatal: 'origin' does not appear to be a git repository` | The remote was saved as `orgin` (typo) | `git remote rename orgin origin`, then push |

Pushed successfully at 22:56.

## Going live with Tailscale Funnel (12 Sep 22:58–23:13)

### Findings
| Finding | Consequence |
|---|---|
| `tailscaled` runs **natively in Termux** (userspace networking), not in Debian | Debian's `tailscale` CLI needs `--socket=<Termux home>/.tailscale/tailscaled.sock`; the default socket was a stale leftover |
| Funnel's main address (`:443`) already served the user's **portfolio** (`serve dist -p 8000`) | The drive needed its own port |
| No password set yet | The user set it privately with `npm run hash-password` (hidden input, stored as scrypt hash, file mode 600) |

### Decision: where to put the drive
| Option | Result |
|---|---|
| **Port 8443** (chosen) | Drive at `https://<phone>.<tailnet>.ts.net:8443`; portfolio untouched |
| Port 10000 | Same, with a different number |
| Replace the portfolio | Portfolio goes offline |

### Issue: `npm start` command split across two lines
`bash: /root/cloud-drive: Is a directory`. The wrapped line ran `cd` with no argument, then tried to
execute the folder. **Fix:** run short commands one at a time.

### Live (23:13), verified from the public internet
- The page and assets load over HTTPS.
- The API returns 401 "Not signed in" without a session.
- Security headers are present.
- The portfolio at the main address still works.

Open question raised at the time: whether Funnel passes each visitor's IP. If not, all visitors would
share one failed-login counter, so a stranger's wrong guesses could briefly lock the owner out.
