#!/usr/bin/env bash
set -Eeuo pipefail

DISPLAY_NUMBER="${DISPLAY:-:99}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
NOVNC_INTERNAL_PORT="${NOVNC_INTERNAL_PORT:-6081}"
SCREEN_WIDTH="${SCREEN_WIDTH:-1365}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-768}"
SCREEN_DEPTH="${SCREEN_DEPTH:-24}"
VNC_PASSWORD="${VNC_PASSWORD:-}"

if [[ -z "${VNC_PASSWORD}" ]]; then
  echo "ERROR: VNC_PASSWORD is required."
  exit 1
fi

mkdir -p /tmp/.X11-unix
mkdir -p /data/browser-profiles
mkdir -p /data/browser-screenshots
mkdir -p /data/vnc

rm -f /tmp/.X99-lock
rm -f /tmp/.X11-unix/X99

cleanup() {
  echo "Stopping Browser Worker services..."

  for pid_var in NOVNC_PID VNC_PID FLUXBOX_PID XVFB_PID; do
    pid="${!pid_var:-}"

    if [[ -n "${pid}" ]]; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

echo "Starting Xvfb on ${DISPLAY_NUMBER}..."
Xvfb "${DISPLAY_NUMBER}"   -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}"   -ac   +extension RANDR   > /tmp/xvfb.log 2>&1 &

XVFB_PID=$!

for attempt in $(seq 1 30); do
  if xdpyinfo -display "${DISPLAY_NUMBER}" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
    echo "Xvfb stopped unexpectedly."
    cat /tmp/xvfb.log || true
    exit 1
  fi

  sleep 1
done

if ! xdpyinfo -display "${DISPLAY_NUMBER}" >/dev/null 2>&1; then
  echo "Xvfb did not become ready."
  cat /tmp/xvfb.log || true
  exit 1
fi

echo "Starting Fluxbox..."
fluxbox   -display "${DISPLAY_NUMBER}"   > /tmp/fluxbox.log 2>&1 &

FLUXBOX_PID=$!

echo "Starting x11vnc (loopback only)..."
x11vnc \
  -display "${DISPLAY_NUMBER}" \
  -nopw \
  -forever \
  -shared \
  -listen 127.0.0.1 \
  -rfbport 5900 \
  -noxdamage \
  -repeat \
  > /tmp/x11vnc.log 2>&1 &

VNC_PID=$!

echo "Starting private noVNC websocket on port ${NOVNC_INTERNAL_PORT}..."
websockify \
  --web=/usr/share/novnc \
  "127.0.0.1:${NOVNC_INTERNAL_PORT}" \
  "127.0.0.1:5900" \
  > /tmp/novnc.log 2>&1 &

NOVNC_PID=$!

echo "Starting Atlas Browser Worker..."
echo "API port: ${BROWSER_WORKER_PORT:-4010}"
echo "Secure viewer port: ${NOVNC_PORT}"
echo "Private noVNC websocket port: ${NOVNC_INTERNAL_PORT}"
echo "Display: ${DISPLAY_NUMBER}"

exec npm run start --workspace apps/browser-worker
