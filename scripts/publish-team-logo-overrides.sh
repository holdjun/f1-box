#!/usr/bin/env bash
# 将本地策展后的车队 logo 覆盖层发布到指定的远端 R2 桶。
# 用法：scripts/publish-team-logo-overrides.sh <bucket> [source-dir]
set -euo pipefail

bucket="${1:?usage: publish-team-logo-overrides.sh <bucket> [source-dir]}"
source_dir_input="${2:-.data/vendor/team-logos}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
wrangler="$repo_dir/apps/web/node_modules/.bin/wrangler"

if [[ "$source_dir_input" = /* ]]; then
  source_dir="$source_dir_input"
else
  source_dir="$repo_dir/$source_dir_input"
fi

index="$source_dir/logos-updated.json"

[ -x "$wrangler" ] || { echo "wrangler not found: $wrangler" >&2; exit 1; }
[ -f "$index" ] || { echo "logo index not found: $index" >&2; exit 1; }

cd "$repo_dir/apps/web"

node - "$index" <<'NODE' | while IFS=$'\t' read -r key local_path content_type; do
const fs = require("fs");
const path = require("path");

const indexPath = process.argv[2];
const sourceDir = path.dirname(indexPath);
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

if (!Array.isArray(index.logos) || index.logos.length === 0) {
  throw new Error("logo index has no logos");
}

for (const entry of index.logos) {
  if (typeof entry.file !== "string" || !entry.file.startsWith("team-logos/")) {
    throw new Error(`invalid logo key: ${entry.file}`);
  }

  const relativePath = entry.file;
  const localPath = path.join(sourceDir, relativePath.replace(/^team-logos\//, ""));
  if (!fs.existsSync(localPath)) {
    throw new Error(`missing logo asset: ${localPath}`);
  }

  const extension = path.extname(localPath).toLowerCase();
  const contentTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  console.log(`${relativePath}\t${localPath}\t${contentTypes[extension] ?? "application/octet-stream"}`);
}
NODE
  echo "uploading $key"
  "$wrangler" r2 object put "$bucket/vendor/$key" \
    --file "$local_path" \
    --content-type "$content_type" \
    --cache-control "public, max-age=31536000, immutable" \
    --remote
done

"$wrangler" r2 object put "$bucket/vendor/team-logos/logos.json" \
  --file "$index" \
  --content-type "application/json" \
  --cache-control "public, max-age=300" \
  --remote

echo "published logo overrides to r2://$bucket/vendor/team-logos"
