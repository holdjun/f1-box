#!/usr/bin/env bash
# 从 f1db 官方 SQLite release 生成 D1 导入 SQL（按表拆分、父表优先）。
# 用法: scripts/f1db-d1-dump.sh [输出目录]（默认 /tmp/f1db-d1）
# 全量导入：表 + 视图原样保留（race_result/fastest_lap 等视图在 D1 可直接查询）。
set -euo pipefail

OUT="${1:-/tmp/f1db-d1}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/f1db-sqlite.zip" \
  https://github.com/f1db/f1db/releases/latest/download/f1db-sqlite.zip
unzip -q "$WORK/f1db-sqlite.zip" -d "$WORK"

# sqlite_master rowid 即建表顺序，天然父表优先
TABLES=()
while IFS= read -r name; do TABLES+=("$name"); done < <(sqlite3 "$WORK/f1db.db" \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid;")
VIEWS=()
while IFS= read -r name; do VIEWS+=("$name"); done < <(sqlite3 "$WORK/f1db.db" \
  "SELECT name FROM sqlite_master WHERE type='view' ORDER BY rowid;")

mkdir -p "$OUT"
rm -f "$OUT"/*.sql

{
  for ((i = ${#VIEWS[@]} - 1; i >= 0; i--)); do
    echo "DROP VIEW IF EXISTS \"${VIEWS[i]}\";"
  done
  for ((i = ${#TABLES[@]} - 1; i >= 0; i--)); do
    echo "DROP TABLE IF EXISTS \"${TABLES[i]}\";"
  done
} > "$OUT/00-drop.sql"

# D1 远端执行不接受显式事务/PRAGMA 语句，wrangler 自行分批提交
idx=1
for name in "${TABLES[@]}"; do
  sqlite3 "$WORK/f1db.db" ".dump $name" \
    | grep -Ev '^(PRAGMA|BEGIN( TRANSACTION)?|COMMIT);$' \
    > "$OUT/$(printf '%02d' "$idx")-$name.sql"
  idx=$((idx + 1))
done

{
  for name in "${VIEWS[@]}"; do
    sqlite3 "$WORK/f1db.db" ".dump $name" \
      | grep -Ev '^(PRAGMA|BEGIN( TRANSACTION)?|COMMIT);$'
  done
} > "$OUT/$(printf '%02d' "$idx")-views.sql"

echo "wrote $((idx + 1)) files to $OUT ($(du -sh "$OUT" | cut -f1))"
