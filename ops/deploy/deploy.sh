#!/bin/bash
# Pull-based auto-deploy for the phone (see "Auto-deploy" in README.md).
#
# One pass: has origin/<branch> moved? Did its CI pass on GitHub? Then back up the database,
# fast-forward, install changed dependencies, run the backend tests, build the web app, boot the
# new code on a spare port as a smoke test, and only then restart the live service and check its
# health. Anything unhealthy is rolled back to the previous commit, and auto-deploy pauses itself
# until the paused file is removed.
#
# Runs inside proot Debian (git, node, npm, gh live there) and calls Termux's `sv` to restart the
# service. Everything is overridable by environment variable, so it can be tested in a sandbox.
set -uo pipefail

REPO=${REPO:-/root/cloud-drive}
STATE_DIR=${STATE_DIR:-/root/cloud-drive-deploy}
BRANCH=${BRANCH:-main}
REMOTE=${REMOTE:-origin}
SERVICE=${SERVICE:-cloud-drive} # empty = don't restart anything (sandbox tests)
SV=${SV:-/data/data/com.termux/files/usr/bin/sv}
SV_DIR=${SV_DIR:-/data/data/com.termux/files/usr/var/service}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3000/api/health}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-90}
SMOKE_PORT=${SMOKE_PORT:-3199}
SMOKE_TIMEOUT=${SMOKE_TIMEOUT:-60}
NPM=${NPM:-npm}
GH=${GH:-gh}
REQUIRE_CI=${REQUIRE_CI:-1}
# Paths that need a rebuild and restart. Changes anywhere else (mobile/, docs/, .github/) are
# fast-forwarded without touching the running server.
DEPLOY_PATHS=${DEPLOY_PATHS:-'^(backend/|frontend/|package\.json|package-lock\.json|ops/)'}
KEEP_BACKUPS=${KEEP_BACKUPS:-3}

log() { printf '%s %s\n' "$(date -u '+%H:%M:%S')" "$*"; }
mkdir -p "$STATE_DIR" || exit 1

# --- one deploy at a time ---
if ! mkdir "$STATE_DIR/lock" 2>/dev/null; then
  log "another deploy is still running; skipping this check"
  exit 0
fi
cleanup() {
  [ -n "${SMOKE_PID:-}" ] && kill "$SMOKE_PID" 2>/dev/null
  rm -rf "$STATE_DIR/smoke"
  rmdir "$STATE_DIR/lock" 2>/dev/null
}
trap cleanup EXIT

[ -f "$STATE_DIR/paused" ] && exit 0 # a previous deploy failed; see the file for why

cd "$REPO" || { log "no repo at $REPO"; exit 1; }

# --- is there anything new, and is the working tree safe to touch? ---
git fetch --quiet "$REMOTE" "$BRANCH" || { log "git fetch failed"; exit 1; }
current=$(git rev-parse HEAD)
target=$(git rev-parse "$REMOTE/$BRANCH")
[ "$current" = "$target" ] && exit 0

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "$BRANCH" ] || { log "on branch '$branch', not '$BRANCH'; leaving it alone"; exit 0; }
if [ -n "$(git status --porcelain)" ]; then
  log "uncommitted changes here; not deploying $(git rev-parse --short "$target")"
  exit 0
fi

subject=$(git log -1 --format='%s' "$target")
short=$(git rev-parse --short "$target")

# --- CI gate: every check on GitHub must have passed for this commit ---
if [ "$REQUIRE_CI" = 1 ]; then
  slug=$(git remote get-url "$REMOTE" | sed -E 's#(git@|https://)github.com[:/]##; s#\.git$##')
  results=$("$GH" api "repos/$slug/commits/$target/check-runs" --jq '[.check_runs[] | .conclusion // "pending"] | join(" ")' 2>/dev/null)
  if [ -z "${results// /}" ]; then
    age=$(( $(date +%s) - $(git log -1 --format=%ct "$target") ))
    if [ "$age" -gt 1800 ]; then
      log "no CI checks for $short after $((age / 60)) min; not deploying (set REQUIRE_CI=0 to skip the gate)"
    else
      log "waiting for CI to start for $short"
    fi
    exit 0
  fi
  for result in $results; do
    case "$result" in
      success | skipped | neutral) ;;
      pending) log "CI still running for $short"; exit 0 ;;
      *)
        if [ "$(cat "$STATE_DIR/ci-failed" 2>/dev/null)" != "$target" ]; then
          log "CI failed for $short ($result): $subject — not deploying"
          echo "$target" >"$STATE_DIR/ci-failed"
        fi
        exit 0
        ;;
    esac
  done
fi

changed=$(git diff --name-only HEAD "$target")
if ! grep -qE "$DEPLOY_PATHS" <<<"$changed"; then
  git merge --ff-only --quiet "$target" && log "synced to $short (no server files changed): $subject"
  exit $?
fi

log "deploying $short: $subject"
started=$(date +%s)

# --- database snapshot (safe while the server is running; keeps the last few) ---
backup_db() {
  local db dest
  db=$(cd "$REPO/backend" && node -e "import('./src/config.js').then((m) => { m.loadEnvFile(); console.log(m.buildConfig().dbPath); })" 2>/dev/null)
  [ -f "$db" ] || { log "no database at '$db'; skipping the backup"; return 0; }
  mkdir -p "$STATE_DIR/db"
  dest="$STATE_DIR/db/$(date -u '+%Y%m%dT%H%M%S')-$short.db"
  (cd "$REPO/backend" && node -e "
    const Database = require('better-sqlite3');
    new Database(process.argv[1]).backup(process.argv[2]).then(() => process.exit(0), (err) => { console.error(err.message); process.exit(1); });
  " "$db" "$dest") || { log "database backup failed"; return 1; }
  ls -1t "$STATE_DIR/db"/*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  log "database backed up to $(basename "$dest")"
}
backup_db || { log "aborting: no usable database backup"; exit 1; }

install_deps() { # $1 = the range of commits whose changed files we're reacting to
  local files=$1 ok=0
  if grep -q '^backend/package-lock\.json$' <<<"$files"; then
    log "installing backend dependencies"
    (cd "$REPO/backend" && "$NPM" ci) || ok=1
  fi
  if grep -q '^frontend/package-lock\.json$' <<<"$files"; then
    log "installing web dependencies"
    (cd "$REPO/frontend" && "$NPM" ci) || ok=1
  fi
  return $ok
}

wait_for() { # url, seconds
  local i
  for ((i = 0; i < $2; i++)); do
    [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$1")" = 200 ] && return 0
    sleep 1
  done
  return 1
}

restart_service() {
  [ -z "$SERVICE" ] && return 0
  SVDIR="$SV_DIR" "$SV" -w 30 restart "$SERVICE" >/dev/null 2>&1
}

pause_deploys() { # reason
  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') auto-deploy paused"; echo "commit: $short $subject"; echo "reason: $1"; echo; echo "Fix the problem, then: rm $STATE_DIR/paused"; } >"$STATE_DIR/paused"
  log "AUTO-DEPLOY PAUSED: $1 (see $STATE_DIR/paused)"
}

roll_back() { # reason
  log "rolling back to $(git rev-parse --short "$current")"
  git reset --hard --quiet "$current"
  install_deps "$changed"
  (cd "$REPO" && "$NPM" run build) >/dev/null 2>&1 || log "rebuild after rollback failed"
  restart_service
  if wait_for "$HEALTH_URL" "$HEALTH_TIMEOUT"; then
    log "rolled back and healthy again"
  else
    log "STILL UNHEALTHY AFTER ROLLBACK — the drive needs attention now"
  fi
  pause_deploys "$1"
  exit 1
}

# --- take the new code ---
git merge --ff-only --quiet "$target" || { log "cannot fast-forward to $short; not deploying"; exit 1; }
install_deps "$changed" || roll_back "dependency install failed"

# --- checks before the live service is touched ---
(cd "$REPO/backend" && "$NPM" test) >"$STATE_DIR/tests.log" 2>&1 || roll_back "backend tests failed on the phone (see $STATE_DIR/tests.log)"
log "backend tests passed"
(cd "$REPO" && "$NPM" run build) >"$STATE_DIR/build.log" 2>&1 || roll_back "web build failed (see $STATE_DIR/build.log)"
log "web app built"

# Boot the new code on a spare port with a throwaway data directory: catches a missing or invalid
# setting, or any startup crash, before the live service is restarted.
if [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/api/health")" != 000 ]; then
  roll_back "port $SMOKE_PORT is already in use, so the new code could not be smoke-tested"
fi
rm -rf "$STATE_DIR/smoke" && mkdir -p "$STATE_DIR/smoke"
# `exec` so $! is node itself and killing it actually stops the server.
(cd "$REPO/backend" && exec env DATA_DIR="$STATE_DIR/smoke" PORT="$SMOKE_PORT" HOST=127.0.0.1 node src/server.js >"$STATE_DIR/smoke.log" 2>&1) &
SMOKE_PID=$!
if wait_for "http://127.0.0.1:$SMOKE_PORT/api/health" "$SMOKE_TIMEOUT"; then
  log "new code starts cleanly on port $SMOKE_PORT"
else
  kill "$SMOKE_PID" 2>/dev/null
  roll_back "the new code did not start (see $STATE_DIR/smoke.log)"
fi
kill "$SMOKE_PID" 2>/dev/null
wait "$SMOKE_PID" 2>/dev/null
SMOKE_PID=
rm -rf "$STATE_DIR/smoke"

# --- restart the live service ---
restart_service || log "sv restart reported a problem; checking health anyway"
if wait_for "$HEALTH_URL" "$HEALTH_TIMEOUT"; then
  log "deployed $short in $(( $(date +%s) - started ))s: $subject"
  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $short $subject"; } >>"$STATE_DIR/history.log"
  rm -f "$STATE_DIR/ci-failed"
else
  roll_back "the drive did not answer $HEALTH_URL within ${HEALTH_TIMEOUT}s after restarting"
fi
