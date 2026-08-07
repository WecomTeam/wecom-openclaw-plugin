#!/usr/bin/env bash
# 本地调试部署：构建并把产物同步到 OpenClaw 扩展目录
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${OPENCLAW_EXTENSIONS_DIR:-$HOME/.openclaw/extensions}/wecom-openclaw-plugin"

echo "==> 构建..."
(cd "$REPO_DIR" && npm run build)

echo "==> 同步到 $EXT_DIR"
mkdir -p "$EXT_DIR"
rsync -a --delete --exclude node_modules --exclude .git "$REPO_DIR/" "$EXT_DIR/"

if [ ! -d "$EXT_DIR/node_modules/@wecom/aibot-node-sdk" ]; then
  echo "==> 首次部署：安装运行时依赖"
  (cd "$EXT_DIR" && npm install --omit=dev --ignore-scripts --no-audit --no-fund)
fi

echo "==> 完成。重启网关生效: openclaw gateway"
