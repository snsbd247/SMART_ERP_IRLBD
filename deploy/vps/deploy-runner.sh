#!/usr/bin/env bash
# ============================================================
#  SmartERP — Deploy Runner (sudo wrapper for update.sh)
#  Installed at /usr/local/bin/smarterp-deploy. The Laravel
#  DeployController invokes it via sudo -n. Writes a PID file
#  and appends to /var/log/smarterp-deploy.log.
# ============================================================
set -u

APP_DIR="${APP_DIR:-/opt/smarterp}"
LOG=/var/log/smarterp-deploy.log
PID=/var/run/smarterp-deploy.pid
STATE=/var/log/smarterp-deploy.state
LOCK=/var/run/smarterp-deploy.lock

if [[ "${1:-}" == "--check" ]]; then
  test -x "${APP_DIR}/deploy/vps/update.sh"
  exit $?
fi

exec 9>"$LOCK"
if ! flock -n 9; then
  existing_pid="$(cat "$PID" 2>/dev/null || true)"
  echo "[$(date +%H:%M:%S)] Deploy already running${existing_pid:+ (pid ${existing_pid})}; ignoring duplicate request."
  echo "running" > "$STATE" 2>/dev/null || true
  exit 0
fi

echo "$$" > "$PID"
trap 'rm -f "$PID"' EXIT
echo "running" > "$STATE" 2>/dev/null || true

echo "[$(date +%H:%M:%S)] ── smarterp-deploy started (pid $$) ──"
echo "[$(date +%H:%M:%S)] APP_DIR=${APP_DIR}"

if ! [ -x "${APP_DIR}/deploy/vps/update.sh" ]; then
  echo "[$(date +%H:%M:%S)] ERROR: ${APP_DIR}/deploy/vps/update.sh not found / not executable"
  echo "[$(date +%H:%M:%S)] DEPLOY FAILED"
  echo "failed" > "$STATE" 2>/dev/null || true
  exit 1
fi

if SMARTERP_DEPLOY_RUNNER=1 APP_DIR="${APP_DIR}" "${APP_DIR}/deploy/vps/update.sh"; then
  echo "[$(date +%H:%M:%S)] DEPLOY OK"
  echo "success" > "$STATE" 2>/dev/null || true
  exit 0
else
  rc=$?
  echo "[$(date +%H:%M:%S)] update.sh exited with code ${rc}"
  echo "[$(date +%H:%M:%S)] DEPLOY FAILED"
  echo "failed" > "$STATE" 2>/dev/null || true
  exit "$rc"
fi
