#!/usr/bin/env bash
# 按文件名顺序把拆分 SQL 导入远端 D1。
# 用法: scripts/f1db-d1-import.sh [sql 目录]（默认 /tmp/f1db-d1）
set -euo pipefail

DIR="${1:-/tmp/f1db-d1}"
WRANGLER=wrangler
if [ -x apps/web/node_modules/.bin/wrangler ]; then
  WRANGLER=apps/web/node_modules/.bin/wrangler
fi

for file in "$DIR"/*.sql; do
  echo "importing $(basename "$file")"
  "$WRANGLER" d1 execute f1db --remote -c apps/web/wrangler.jsonc --file "$file" \
    | grep -E 'rows_written|ERROR' || true
done
echo "import complete"
