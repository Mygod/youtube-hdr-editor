#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="youtube-hdr-editor"
INTERVAL_MINUTES="${1:-10}"
YARN_BIN="$(command -v yarn || true)"

if [[ -z "${YARN_BIN}" ]]; then
  echo "yarn was not found on PATH" >&2
  exit 1
fi

if ! [[ "${INTERVAL_MINUTES}" =~ ^[1-9][0-9]*$ ]]; then
  echo "interval must be a positive integer number of minutes" >&2
  exit 1
fi

mkdir -p "${USER_SYSTEMD_DIR}"

SERVICE_PATH="${USER_SYSTEMD_DIR}/${UNIT_NAME}.service"
TIMER_PATH="${USER_SYSTEMD_DIR}/${UNIT_NAME}.timer"

cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=YouTube HDR editor automation
After=default.target

[Service]
Type=oneshot
WorkingDirectory=${REPO_DIR}
ExecStart=${YARN_BIN} rerun
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
NoNewPrivileges=true
EOF

cat > "${TIMER_PATH}" <<EOF
[Unit]
Description=Run YouTube HDR editor automation every ${INTERVAL_MINUTES} minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=${INTERVAL_MINUTES}min
Persistent=true
AccuracySec=1s
Unit=${UNIT_NAME}.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "${UNIT_NAME}.timer"

echo "Installed ${UNIT_NAME}.service and ${UNIT_NAME}.timer"
systemctl --user status "${UNIT_NAME}.timer" --no-pager
echo
echo "If you want this to keep running when you are logged out, run:"
echo "  sudo loginctl enable-linger ${USER}"
