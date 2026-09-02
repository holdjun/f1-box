#!/usr/bin/env bash
# 按文件名顺序把拆分 SQL 导入远端 D1。整轮失败从头重试（00-drop 先清表，整轮幂等）。
# 用法: scripts/f1db-d1-import.sh [sql 目录]（默认 /tmp/f1db-d1）
set -euo pipefail

DIR="${1:-/tmp/f1db-d1}"
WRANGLER=wrangler
if [ -x apps/web/node_modules/.bin/wrangler ]; then
  WRANGLER=apps/web/node_modules/.bin/wrangler
fi

ls "$DIR"/*.sql > /dev/null 2>&1 || { echo "no .sql files in $DIR" >&2; exit 1; }

run_import() {
  for file in "$DIR"/*.sql; do
    echo "importing $(basename "$file")"
    if ! "$WRANGLER" d1 execute f1db --remote -c apps/web/wrangler.jsonc --file "$file" > /tmp/d1-import-step.log 2>&1; then
      cat /tmp/d1-import-step.log
      echo "import failed at $(basename "$file")" >&2
      return 1
    fi
  done
}

# D1 远端导入偶发断开会话（2026-08-24 观测两次：启动内部错误、大表分块超时）；
# 失败文件可能半应用，逐文件重试会重复插行，故从 00-drop 整轮重来
attempt=1
until run_import; do
  if [ "$attempt" -ge 3 ]; then
    echo "import failed after $attempt attempts" >&2
    exit 1
  fi
  echo "attempt $attempt failed, restarting full import in 15s"
  attempt=$((attempt + 1))
  sleep 15
done
# 刷新统计信息：没有 sqlite_stat1 时规划器会挑错驱动表（实测退回全扫 race_data 18 万行）
"$WRANGLER" d1 execute f1db --remote -c apps/web/wrangler.jsonc --command "ANALYZE;" > /dev/null
echo "import complete"
