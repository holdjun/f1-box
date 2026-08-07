#!/usr/bin/env bash
# 按文件名顺序把拆分 SQL 导入远端 D1。任一步失败立即非零退出。
# 用法: scripts/f1db-d1-import.sh [sql 目录]（默认 /tmp/f1db-d1）
set -euo pipefail

DIR="${1:-/tmp/f1db-d1}"
WRANGLER=wrangler
if [ -x apps/web/node_modules/.bin/wrangler ]; then
  WRANGLER=apps/web/node_modules/.bin/wrangler
fi

for file in "$DIR"/*.sql; do
  echo "importing $(basename "$file")"
  if ! "$WRANGLER" d1 execute f1db --remote -c apps/web/wrangler.jsonc --file "$file" > /tmp/d1-import-step.log 2>&1; then
    cat /tmp/d1-import-step.log
    echo "import failed at $(basename "$file")" >&2
    exit 1
  fi
done
echo "import complete"
