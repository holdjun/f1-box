#!/usr/bin/env bash
# 手动发布一个本地 release 目录到 R2：先传不可变 payload，最后更新 manifest。
# 用法：scripts/publish-release.sh <release-dir> [season]
set -euo pipefail

release_dir="${1:?usage: publish-release.sh <release-dir> [season]}"
season="${2:-2026}"
bucket="f1-box-data"
season_dir="$release_dir/v1/seasons/$season"

payload_path=$(ls "$season_dir" | grep -E '^[a-f0-9]{64}\.json$' | head -1)
[ -n "$payload_path" ] || { echo "no checksum payload found in $season_dir" >&2; exit 1; }

cd "$(dirname "$0")/../apps/web"
pnpm exec wrangler r2 object put "$bucket/v1/seasons/$season/$payload_path" --file "$season_dir/$payload_path"
pnpm exec wrangler r2 object put "$bucket/v1/seasons/$season/latest.json" --file "$season_dir/latest.json"
echo "published v1/seasons/$season/$payload_path"
