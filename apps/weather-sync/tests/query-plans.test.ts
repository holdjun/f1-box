import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const domainSource = readFileSync(
  path.join(repoRoot, "apps/weather-sync/src/domain.ts"),
  "utf8",
);
const siteTables = readFileSync(
  path.join(repoRoot, "scripts/site-tables.sql"),
  "utf8",
);

let dbPath: string;
let queries: Array<{ key: string; sql: string }>;

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "f1box-weather-plan-"));
  dbPath = path.join(dir, "weather.db");
  const run = (script: string) =>
    execFileSync("sqlite3", [dbPath], { input: script, encoding: "utf8" });
  run(siteTables);

  queries = [];
  const pattern = /export const (\w+Sql) = `([\s\S]*?)`;/g;
  for (const match of domainSource.matchAll(pattern)) {
    const sql = match[2].replace(/\?\d+/g, "?").trim();
    if (/^(SELECT|WITH)/i.test(sql)) queries.push({ key: match[1], sql });
  }
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("weather ingestion query plans", () => {
  it("collects the read queries", () => {
    expect(queries.map((query) => query.key)).toEqual(
      expect.arrayContaining(["candidateSql", "statusSql", "outboxSql"]),
    );
  });

  it("does not fully scan site tables", () => {
    for (const query of queries) {
      const plan = execFileSync("sqlite3", [dbPath], {
        input: `EXPLAIN QUERY PLAN ${query.sql.replace(/;\s*$/, "")};`,
        encoding: "utf8",
      });
      const scans = [
        ...plan
          .split("\n")
          .filter((line) => !line.includes("USING"))
          .join("\n")
          .matchAll(/\bSCAN (\w+)\b/g),
      ]
        .map((match) => match[1])
        .filter((table) => !["session_keys"].includes(table));
      expect(scans, query.key).toEqual([]);
    }
  });
});
