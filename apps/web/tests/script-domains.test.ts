import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// "不使用 Jolpica/Ergast" 的范围：不在自己代码里直接请求它们。
// 经 FastF1 内部间接走到是允许的（请求由 FastF1 管理），所以这里只拦源码里
// 直接出现的 URL 主机，并把可能的上游限定在白名单内。

const scriptsDir = fileURLToPath(new URL("../../../scripts", import.meta.url));
const workflowsDir = fileURLToPath(
  new URL("../../../.github/workflows", import.meta.url),
);
// 三条管线各有一个 sync 脚本；先交付的管线先注册，后续管线交付时补进集合。
const SCRIPT_GLOB = new Set(["sync-session-times.py", "sync-weather.py"]);

// 允许出现的网络主机。脚本回填可能用到的上游：
// - raw.githubusercontent.com：FastF1 的赛程文件（backend="fastf1"）
// - github.com / objects.githubusercontent.com：f1db 官方 SQLite release 下载
// - api.open-meteo.com：Open-Meteo 预报（天气 forecast 占位）
// - api.github.com：release 元数据查询
// - livetiming.formula1.com：由 FastF1 内部请求（我们不经脚本硬编码），列白名单供核对
// 允许域名白名单之外的主机一律视为未申报。
const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "objects.githubusercontent.com",
  "api.github.com",
  "api.open-meteo.com",
  "livetiming.formula1.com",
]);

// 一处断言，两处复用：scripts/ 下的 sync 脚本，以及 workflow YAML 里的内联脚本。
// 经 FastF1 间接走到 Jolpica 是允许的，所以这里不管 load()；管的是后端选择要显式。
// backend 默认为 None 时由 FastF1 自己挑，版本一变取数路径就变了，而回填脚本
// 必须可重现：同一个赛季重跑两次应当得到同一批数据。
// 先剥掉注释行（Python 与 YAML 同为 #），注释里提到调用名不算调用。
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

describe("sync 脚本请求域名白名单", () => {
  it("至少注册一个 sync 脚本", () => {
    const files = readdirSync(scriptsDir).filter((name) =>
      SCRIPT_GLOB.has(name),
    );
    expect(files).not.toHaveLength(0);
  });

  for (const script of [...SCRIPT_GLOB]) {
    it(`${script} 不直接请求 Jolpica/Ergast，未申报域名会红`, () => {
      const source = readFileSync(`${scriptsDir}/${script}`, "utf8");
      // 提取源码里出现的每个 http(s) 主机。注释里的"ergast"字眼不算（FastF1 内部路径，
      // 不由我们请求），只有真实 URL 主机才算引用。
      const hosts = new Set<string>();
      for (const match of source.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/gi)) {
        hosts.add(match[1].toLowerCase().replace(/^www\./, ""));
      }
      for (const host of hosts) {
        // 白名单之外的未申报主机，以及 Jolpica/Ergast 无论是否在白名单都该红
        const isJolpica = host === "jolpi.ca" || host.endsWith(".jolpi.ca");
        const isErgast = host === "ergast.com" || host.endsWith(".ergast.com");
        expect(
          !isJolpica && !isErgast && ALLOWED_HOSTS.has(host),
          `${script} 引用未申报/禁用主机 ${host}`,
        ).toBe(true);
      }
    });
  }

  for (const script of [...SCRIPT_GLOB]) {
    it(`${script} 的后端选择是显式的`, () => {
      assertExplicitBackend(
        readFileSync(`${scriptsDir}/${script}`, "utf8"),
        script,
      );
    });
  }

  // 探针这类内联 Python 住在 workflow YAML 里，不在 scripts/ 下，按文件名注册的
  // 护栏扫不到它们，而探针正是最容易随手写、最需要可重现的一类代码。
  it("workflow 内联脚本的后端选择也是显式的", () => {
    const names = readdirSync(workflowsDir).filter((name) =>
      name.endsWith(".yml"),
    );
    expect(names).not.toHaveLength(0);
    for (const name of names) {
      assertExplicitBackend(
        readFileSync(`${workflowsDir}/${name}`, "utf8"),
        name,
      );
    }
  });
});
