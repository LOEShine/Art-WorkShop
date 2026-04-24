#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/www/wwwroot/ai}"

cd "$ROOT_DIR"

echo "[deploy] working directory: $ROOT_DIR"
echo "[deploy] target directory: $DEPLOY_DIR"

npm ci
npm run build

mkdir -p "$DEPLOY_DIR"

rsync -av --delete \
  --exclude=".well-known" \
  --exclude=".user.ini" \
  --exclude=".htaccess" \
  --exclude="404.html" \
  --exclude="index.html.bak-*" \
  "dist/" "$DEPLOY_DIR/"

echo "[deploy] completed at $(date '+%Y-%m-%d %H:%M:%S')"
