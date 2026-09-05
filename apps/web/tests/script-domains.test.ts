import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// "不使用 Jolpica/Ergast" 是绝对的，包括 FastF1 内部的间接调用。光扫 URL 不够：
// FastF1 的 Session.load() 与不带 backend 的 get_session()/get_event_schedule()
// 会在内部走 ergast 后端，源码里一个域名字符串都不会出现。所以这里同时拦两类：
// 直接请求的未申报主机，以及会静默转到 ergast 的 FastF1 调用形式。

const scriptsDir = fileURLToPath(new URL("../../../scripts", import.meta.url));
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
    it(`${script} 不会静默走到 ergast 后端`, () => {
      const source = readFileSync(`${scriptsDir}/${script}`, "utf8");
      // Session.load() 无条件拉 ergast（fastf1/core.py _load_drivers_results），
      // force_ergast 更是直说。两者在源码里出现即视为违约。
      expect(/\.load\s*\(/.test(source), `${script} 调用了 load()`).toBe(false);
      expect(/force_ergast/.test(source), `${script} 用了 force_ergast`).toBe(
        false,
      );
      // get_session / get_event_schedule 的 backend 默认为 None，FastF1 会自己选，
      // 选到 ergast 就静默打 jolpica。每个调用点都必须显式写 backend="fastf1"。
      for (const match of source.matchAll(
        /\b(get_session|get_event_schedule)\s*\(/g,
      )) {
        const call = source.slice(match.index, match.index + 200);
        expect(
          call.includes('backend="fastf1"'),
          `${script} 的 ${match[1]} 没有显式传 backend="fastf1"`,
        ).toBe(true);
      }
    });
  }
});
