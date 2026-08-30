#!/usr/bin/env bash
# T-075 (2026-08-30): launches the Flutter web dev server pointed at the
# local backend/ai-service stack (localhost:5000) instead of the
# production Railway URL that's baked in as mobile/lib/core/constants/
# api_constants.dart's compile-time default.
#
# Deliberately does NOT edit anything under mobile/ -- mobile/ is a
# standing off-limits directory for this engagement (see CLAUDE.md).
# api_constants.dart's own top comment already documents the supported
# override mechanism (--dart-define=API_BASE_URL=...); this script just
# supplies it automatically so nobody testing locally has to remember the
# flags or accidentally launches against production. The production
# build (flutter build apk/web --release, no dart-defines) is completely
# unaffected -- it still resolves to the Railway default exactly as
# before.
#
# Usage:
#   ./scripts/run-mobile-web-local.sh [extra flutter run args...]
#
# Requires backend (localhost:5000) and ai-service (localhost:8000)
# already running locally, and backend's .env to have
# ALLOWED_ORIGINS=* (or explicitly include http://localhost:5173) --
# see backend/.env.example, "local dev only" per this project's CORS
# security rules.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${WEB_PORT:-5173}"
LOCAL_BACKEND="${LOCAL_BACKEND_URL:-http://localhost:5000}"
LOCAL_WS="${LOCAL_WS_URL:-ws://localhost:5000/ws}"

echo "[run-mobile-web-local] Launching Flutter web dev server on :${PORT}, pointed at ${LOCAL_BACKEND}"

cd "$REPO_ROOT/mobile"
exec flutter run -d web-server \
  --web-port="$PORT" \
  --web-hostname=0.0.0.0 \
  --dart-define=API_BASE_URL="$LOCAL_BACKEND" \
  --dart-define=WS_URL="$LOCAL_WS" \
  "$@"
