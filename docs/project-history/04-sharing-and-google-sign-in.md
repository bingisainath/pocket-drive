# 4. Sharing and Google Sign-In (13 Sep 2026)

## The request (13 Sep 12:47)

Let friends upload photos to certain folders, let chosen people view certain folders, and keep personal
folders invisible to anyone they aren't shared with, all controlled by email. First: an overview of how,
and what security and system concepts apply, *without implementing*.

## Design overview given

### Permission model: folder sharing, like Google Drive
- **Default deny:** nothing is visible unless shared.
- **Folder-level shares** by email and role, **inherited** by everything inside.
- Friends don't see the owner's root. They get a **"Shared with me"** page.

| Role | View/download | Upload/new folder | Delete |
|---|---|---|---|
| Viewer | ✅ | – | – |
| Contributor | ✅ | ✅ | only their own uploads |
| Editor | ✅ | ✅ | anything in the folder |
| Owner | ✅ everywhere | ✅ | ✅ |

### Login options compared
| Option | Trade-off |
|---|---|
| **Sign in with Google** (recommended) | No passwords to manage, naturally email-based; needs a free Google Cloud OAuth client |
| Invite link + password | No outside dependency; the owner manages resets |
| Magic link by email | Needs an email-sending service |

### Security concepts
- **Authentication vs authorisation:** logging in proves identity; one central permission check on every request decides access.
- **IDOR prevention:** file URLs use numeric ids, so download, preview and thumbnail routes must check the file's folder, or friends could guess ids.
- **No side-door leaks:** filter search, thumbnails, item counts, storage stats and breadcrumbs. Answer **404, not 403**, so private folders can't even be detected.
- **Least privilege:** only the owner can rescan, see device storage, or manage shares.
- **Live revocation:** permissions are checked per request, so removing someone takes effect immediately.
- Rate limits per account; an audit log; quotas; optional EXIF/GPS stripping; expiring share links.

### System concepts raised (some built later)
Cheap path-prefix permission lookups, pagination, **resumable uploads**, deduplication by hash,
**smaller preview images**, a background job queue, and the phone's limits (CPU, uplink, storage).

## Question round (13 Sep 15:41)

| Question | Options | Chosen |
|---|---|---|
| Owner sign-in | **Google + password backup** / Google only | Google + password backup: the password still works if Google login breaks or on addresses Google won't allow |
| What Contributors may delete | **Only their own uploads** / nothing | Only their own uploads |
| Extras in this branch | **None for now** (recommended) / Activity log / per-person quotas / upload-only "drop box" role | **Activity log** only (the user chose an extra over the recommendation) |

## Implementation (branch `feature/sharing-google-auth`, 3 commits, 13 Sep 17:10)

Built in a **git worktree** (`/root/cloud-drive-dev`) so the live service on `main` kept running
untouched. Dependencies were shared via symlinks.

- **Accounts:** owner set by `OWNER_EMAIL`; everyone else signs in with Google.
- **Google sign-in:** OpenID Connect with **PKCE, state and nonce**; login-CSRF protection via a
  state cookie; allowed return addresses from `PUBLIC_ORIGINS`.
- **Shares:** Viewer/Contributor/Editor per folder; the strongest applicable share wins; private
  items return 404.
- **Owner tools:** Share dialog, People & access (removing someone signs them out instantly),
  Activity log, share badges on folders.
- **Database migration:** additive (users, shares, activity tables; sessions tied to users).
  Tested on a **copy of the live database: upgraded in 63 ms, all 203 entries preserved**.
  Deploying signs everyone out once.

### Testing
| Suite | Result |
|---|---|
| Backend | **50 tests passing**, 25 new: every role × every action, private vs shared, Google sign-in security checks (with a stand-in Google) |
| Browser | Full suite passing, including the owner sharing a folder, the friend's limited view, and an uninvited person being refused |

### Bugs found and fixed on the branch
| Bug | Fix |
|---|---|
| Pressing Escape didn't close a sheet opened via "⋮" (also on live `main`) | Escape handling for sheets |
| The upload panel covered photos after uploads finished | Dismiss/position fix |

## Deploying it (13 Sep 17:14–17:40)

The user pushed and deployed by hand, with commands provided: stop the service, back up the database,
merge, build, add settings, start, plus a documented rollback (`git reset --hard b326edb` and restore
the database backup).

### "What is a Google client ID and secret?"
| | Example shape | Secret? |
|---|---|---|
| Client ID | `…apps.googleusercontent.com` | No: the app's public name |
| Client secret | `GOCSPX-…` | **Yes**: only in `backend/.env`, never in chat or git |

Steps: Google Cloud Console → project → OAuth consent screen (External; add friends as test users,
or publish) → Credentials → OAuth client (Web application) → authorised redirect URI
`<origin>/api/auth/google/callback`.

### Issue: `sv up cloud-drive` failed inside Debian
| | |
|---|---|
| **Symptom** | `fail: cloud-drive: unable to change to service directory: file does not exist` |
| **Cause** | `sv` is a Termux tool; inside Debian, `$SVDIR`/`$PREFIX` point nowhere, so the old version was still running |
| **Fix** | Run `sv` from a Termux shell, or from Debian: `SVDIR=/data/data/com.termux/files/usr/var/service sv restart cloud-drive` |

The same mistake recurred on 16 Sep, caused by instructions using `$PREFIX` in a Debian shell. The full
path is now the documented way.

After this, the log showed the owner and `Google sign-in: on for …:8443`. The feature was live.
