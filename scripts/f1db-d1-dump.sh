#!/usr/bin/env bash
# 从 f1db 官方 SQLite release 生成 D1 导入 SQL（按表拆分、父表优先）。
# 用法: scripts/f1db-d1-dump.sh [输出目录]（默认 /tmp/f1db-d1）
# 00-drop 反序清库后逐表重建（外键约束下无法逐表单独 drop），
# 整库重导窗口存在，靠 data-sync 的 release tag 门禁收敛到每周一次；
# 索引统一放 f1db-d1-indexes.sql，附在 race_data（最后一张相关表）的 dump 之后。
# 逐表 dump 只带 CREATE TABLE 与 INSERT，上游那 164 条索引不会随之过来——
# 这是 D1 上只有主键自动索引的原因，也是查询计划夹具必须由本脚本产出的原因。
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
  # f1db 只建主键/唯一约束索引，高频过滤列（constructor_id、driver_id、circuit_id）没有
  if [ "$name" = "race_data" ]; then
    cat "$(dirname "$0")/f1db-d1-indexes.sql" >> "$OUT/$(printf '%02d' "$idx")-$name.sql"
  fi
  idx=$((idx + 1))
done

{
  for name in "${VIEWS[@]}"; do
    echo "DROP VIEW IF EXISTS \"$name\";"
  done
  for name in "${VIEWS[@]}"; do
    sqlite3 "$WORK/f1db.db" ".dump $name" \
      | grep -Ev '^(PRAGMA|BEGIN( TRANSACTION)?|COMMIT);$'
  done
} > "$OUT/$(printf '%02d' "$idx")-views.sql"

echo "wrote $((idx + 1)) files to $OUT ($(du -sh "$OUT" | cut -f1))"

# 查询计划夹具：与导入产物同源的表/视图定义，不含索引——正是 D1 导入后的形态。
# 提交它，tests/d1-query-plans.test.ts 靠它在真实 schema 上验证每条查询的计划。
SCHEMA_FIXTURE="$(dirname "$0")/../apps/web/tests/fixtures/d1-schema.sql"
{
  echo "-- 由 scripts/f1db-d1-dump.sh 生成，勿手改。"
  echo "-- f1db 上游的表与视图定义，索引另见 scripts/f1db-d1-indexes.sql。"
  sqlite3 "$WORK/f1db.db" \
    "SELECT sql || ';' FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY rowid;"
} > "$SCHEMA_FIXTURE"
echo "refreshed $SCHEMA_FIXTURE"
