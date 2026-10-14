#!/bin/sh
set -u
LIFETIME="${SERVICE_LIFETIME_SECONDS:-3600}"
node /app/server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM
echo "공개 링크는 ${LIFETIME}초 후 자동으로 닫힙니다."
timeout -s TERM "$LIFETIME" cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080 || true
echo "롤링페이퍼 서비스가 종료되었습니다."
exit 0
