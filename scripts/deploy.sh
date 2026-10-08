#!/usr/bin/env bash
# SmartCook backend auto-deploy. Run on the VPS by smartcook-deploy.timer
# (every minute) or by hand: bash scripts/deploy.sh
#
# Flow: fetch origin/main -> if new commit: reset --hard, npm ci (only when
# package*.json changed), syntax check, pm2 restart, health check. If the new
# build does not become healthy it rolls back to the previous commit and
# remembers the bad commit so it is not retried every minute.
#
# `git reset --hard` only touches tracked files, so .env, node_modules/, data/
# and the service-account json (all gitignored) are never overwritten.
#
# The whole body is a function and the file ends with `exit`: bash reads a
# script incrementally, and this script is itself overwritten by the reset.
set -u

APP_DIR="${APP_DIR:-/root/smartcook-backend}"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-smartcook-backend}"
LOG="${LOG:-/root/smartcook-deploy.log}"
BAD_FILE="${BAD_FILE:-/root/.smartcook-bad-commits}"
LOCK="${LOCK:-/tmp/smartcook-deploy.lock}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-45}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

healthy() {
  local port body
  port=$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"\r ')
  body=$(curl -s -m 5 "http://127.0.0.1:${port:-3000}/api/health" || true)
  echo "$body" | grep -q '"success":true' && echo "$body" | grep -q '"mongodb":"connected"'
}

wait_healthy() {
  local i
  for ((i = 0; i < HEALTH_TIMEOUT; i += 3)); do
    sleep 3
    healthy && return 0
  done
  return 1
}

install_deps() {
  (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund >> "$LOG" 2>&1)
}

syntax_ok() {
  cd "$APP_DIR" || return 1
  node --check server.js >> "$LOG" 2>&1 || return 1
  find src scripts -name '*.js' -print0 | xargs -0 -n1 node --check >> "$LOG" 2>&1
}

main() {
  exec 9>"$LOCK"
  flock -n 9 || exit 0          # another deploy is running

  export GIT_TERMINAL_PROMPT=0
  cd "$APP_DIR" || exit 1
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { log "not a git repo: $APP_DIR"; exit 1; }

  git fetch --quiet origin "$BRANCH" 2>>"$LOG" || { log "fetch failed (network?), will retry"; exit 0; }

  local cur new
  cur=$(git rev-parse HEAD)
  new=$(git rev-parse "origin/$BRANCH")
  [ "$cur" = "$new" ] && exit 0
  if grep -qx "$new" "$BAD_FILE" 2>/dev/null; then exit 0; fi   # known-bad, wait for a newer commit

  log "deploy start ${cur:0:7} -> ${new:0:7}: $(git log -1 --format=%s "$new")"
  local pkg_changed=0
  git diff --name-only "$cur" "$new" | grep -qE '^package(-lock)?\.json$' && pkg_changed=1

  git reset --hard "$new" >> "$LOG" 2>&1 || { log "reset failed"; exit 1; }

  if [ "$pkg_changed" = 1 ]; then
    log "dependencies changed, npm ci"
    install_deps || { log "npm ci failed"; rollback "$cur" "$new" 1; exit 1; }
  fi
  syntax_ok || { log "syntax check failed"; rollback "$cur" "$new" "$pkg_changed"; exit 1; }

  pm2 restart "$PM2_NAME" >> "$LOG" 2>&1
  if wait_healthy; then
    log "deploy OK ${new:0:7}"
    exit 0
  fi
  log "health check failed after ${HEALTH_TIMEOUT}s"
  rollback "$cur" "$new" "$pkg_changed"
  exit 1
}

rollback() {
  local to="$1" bad="$2" reinstall="$3"
  echo "$bad" >> "$BAD_FILE"
  log "rolling back to ${to:0:7}"
  cd "$APP_DIR" || return
  git reset --hard "$to" >> "$LOG" 2>&1
  [ "$reinstall" = 1 ] && install_deps
  pm2 restart "$PM2_NAME" >> "$LOG" 2>&1
  if wait_healthy; then log "rollback OK"; else log "ROLLBACK ALSO UNHEALTHY - needs a human"; fi
}

main "$@"
exit $?
