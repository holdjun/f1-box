#!/usr/bin/env bash
# 从 f1db 官方 SQLite release 生成 D1 导入 SQL（参考表子集）。
# 用法: scripts/f1db-d1-dump.sh [输出文件]（默认 /tmp/f1db-d1-subset.sql）
# 子集只含站点查询需要的参考表；比赛级明细（圈速/练习/排位等）不导入。
set -euo pipefail

OUT="${1:-/tmp/f1db-d1-subset.sql}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/f1db-sqlite.zip" \
  https://github.com/f1db/f1db/releases/latest/download/f1db-sqlite.zip
unzip -q "$WORK/f1db-sqlite.zip" -d "$WORK"

# 先删子表再删父表，外键开启时也安全
DROP_ORDER=(
  season_constructor_standing
  season_entrant_driver
  season_entrant_engine
  season_entrant_chassis
  season_entrant_constructor
  season_entrant
  chassis
  entrant
  engine
  driver
  constructor
  engine_manufacturer
  season
  country
  continent
)

# D1 默认开启外键，建表必须父表优先
TABLES=(
  continent
  country
  season
  engine_manufacturer
  constructor
  driver
  engine
  entrant
  chassis
  season_entrant
  season_entrant_constructor
  season_entrant_chassis
  season_entrant_engine
  season_entrant_driver
  season_constructor_standing
)

{
  for t in "${DROP_ORDER[@]}"; do
    echo "DROP TABLE IF EXISTS \"$t\";"
  done
  for t in "${TABLES[@]}"; do
    # D1 远端执行不接受显式事务语句，wrangler 自行分批提交
    sqlite3 "$WORK/f1db.db" ".dump $t" | grep -Ev '^(BEGIN( TRANSACTION)?|COMMIT);$'
  done
} > "$OUT"

echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
