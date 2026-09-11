import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const scriptsDir = path.join(repoRoot, "scripts");
const workflowsDir = path.join(repoRoot, ".github/workflows");
const syncScripts = [
  path.join(scriptsDir, "sync-session-times.py"),
  path.join(repoRoot, "apps/weather-sync/container/app.py"),
];

// “不使用 Jolpica/Ergast”的范围是自己代码不直接请求它们；FastF1 内部间接访问
// 由依赖管理。这里同时拦直接 URL 与隐式后端选择。
const allowedHosts = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "objects.githubusercontent.com",
  "api.github.com",
  "livetiming.formula1.com",
]);

function assertExplicitBackend(source: string, label: string): void {
  const code = source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  for (const match of code.matchAll(
    /\b(get_session|get_event_schedule)\s*\(/g,
  )) {
    const call = code.slice(match.index, match.index + 200);
    expect(
      call.includes('backend="fastf1"'),
      `${label} 的 ${match[1]} 没有显式传 backend="fastf1"`,
    ).toBe(true);
  }
}

describe("FastF1 请求边界", () => {
  for (const script of syncScripts) {
    it(`${path.basename(script)} 不直接请求禁用域名且后端显式`, () => {
      const source = readFileSync(script, "utf8");
      const hosts = new Set<string>();
      for (const match of source.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/gi)) {
        hosts.add(match[1].toLowerCase().replace(/^www\./, ""));
      }
      for (const host of hosts) {
        const isJolpica = host === "jolpi.ca" || host.endsWith(".jolpi.ca");
        const isErgast = host === "ergast.com" || host.endsWith(".ergast.com");
        expect(
          !isJolpica && !isErgast && allowedHosts.has(host),
          `${script} 引用未申报/禁用主机 ${host}`,
        ).toBe(true);
      }
      assertExplicitBackend(source, script);
    });
  }

  it("workflow 内联脚本的后端选择也是显式的", () => {
    for (const name of ["data-sync.yml", "site-data.yml"] as const) {
      assertExplicitBackend(
        readFileSync(path.join(workflowsDir, name), "utf8"),
        name,
      );
    }
  });

  it("FastF1 当前的 Sprint Qualifying 名称映射到站点键", () => {
    const output = execFileSync(
      "python3",
      [
        "-c",
        `import sys; sys.path.insert(0, ${JSON.stringify(scriptsDir)}); from f1_session_keys import session_key; print(session_key("Sprint Qualifying"))`,
      ],
      { encoding: "utf8" },
    ).trim();
    expect(output).toBe("sprint-qualifying");
  });

  it("所有 Worker 部署前都应用站点表", () => {
    const source = readFileSync(path.join(workflowsDir, "ci.yml"), "utf8");
    const jobs = [
      "preview",
      "weather-preview",
      "production",
      "weather-production",
    ];
    for (const [index, job] of jobs.entries()) {
      const start = source.indexOf(`  ${job}:`);
      const end =
        index + 1 < jobs.length
          ? source.indexOf(`  ${jobs[index + 1]}:`)
          : source.length;
      const block = source.slice(start, end);
      const schema = block.indexOf("--file scripts/site-tables.sql");
      const deploy = block.indexOf("wrangler deploy");
      expect(schema, `${job} 缺少站点表部署步骤`).toBeGreaterThan(-1);
      expect(deploy, `${job} 缺少 Worker 部署步骤`).toBeGreaterThan(-1);
      expect(schema, `${job} 必须先建表再部署 Worker`).toBeLessThan(deploy);
    }
  });
});
