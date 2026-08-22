#!/usr/bin/env bash
# 从 f1db 仓库提取赛道轮廓 SVG（white 变体）入库 public/vendor/circuits/。
# 用法: scripts/f1db-circuit-svg-sync.sh
# f1db release 产物不含 SVG，只能走 git 仓库；新增布局时手动跑一次。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/web/public/vendor/circuits"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/f1db.tar.gz" \
  https://codeload.github.com/f1db/f1db/tar.gz/refs/heads/main
tar -xzf "$WORK/f1db.tar.gz" -C "$WORK" "f1db-main/src/assets/circuits/white"

mkdir -p "$DEST"
rm -f "$DEST"/*.svg
mv "$WORK/f1db-main/src/assets/circuits/white/"*.svg "$DEST"/
echo "synced $(ls "$DEST" | wc -l | tr -d ' ') circuit svgs to $DEST"
