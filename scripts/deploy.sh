#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-darkabyss-discord-bot}"
BRANCH="${BRANCH:-main}"
DEPLOY_DIR="${DEPLOY_DIR:-/var/www/discord-bot}"

if [ ! -d "$DEPLOY_DIR/.git" ]; then
  echo "Deploy directory is not a git repository: $DEPLOY_DIR"
  exit 1
fi

cd "$DEPLOY_DIR"

echo "Fetching latest code for branch: $BRANCH"
git fetch --all --prune
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "Installing dependencies"
npm ci --omit=dev

echo "Reloading PM2 app: $APP_NAME"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 startOrRestart ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs --update-env
fi

pm2 save

echo "Deploy finished successfully"
