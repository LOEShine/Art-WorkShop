#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/LOEShine/Art-WorkShop.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/art-workshop}"
DEPLOY_DIR="${DEPLOY_DIR:-/www/wwwroot/ai}"
LAST_DEPLOYED_FILE="${LAST_DEPLOYED_FILE:-$APP_DIR/.last-deployed-commit}"

mkdir -p "$(dirname "$APP_DIR")"

if [[ ! -d "$APP_DIR/.git" ]]; then
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

git fetch origin "$BRANCH"

REMOTE_COMMIT="$(git rev-parse "origin/$BRANCH")"
CURRENT_COMMIT="$(git rev-parse HEAD)"
LAST_DEPLOYED_COMMIT=""

if [[ -f "$LAST_DEPLOYED_FILE" ]]; then
  LAST_DEPLOYED_COMMIT="$(cat "$LAST_DEPLOYED_FILE")"
fi

if [[ "$LAST_DEPLOYED_COMMIT" == "$REMOTE_COMMIT" ]]; then
  echo "[sync] no changes detected"
  exit 0
fi

if [[ "$CURRENT_COMMIT" != "$REMOTE_COMMIT" ]]; then
  git checkout "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
fi

DEPLOY_DIR="$DEPLOY_DIR" bash "$APP_DIR/scripts/deploy.sh"

echo "$REMOTE_COMMIT" > "$LAST_DEPLOYED_FILE"
echo "[sync] deployed commit $REMOTE_COMMIT"

