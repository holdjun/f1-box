---
name: data-foundation-state
description: 数据地基完成态：R2 vendor 布局、覆盖数字、分支/PR、策展工作副本位置、下一任务车队页要点
metadata: 
  node_type: memory
  type: project
  originSessionId: b4b6b604-7c1a-43a9-ba18-30f7b3d52fd6
  modified: 2026-08-08T08:37:02.651Z
---

2026-08-07 数据地基第一轮完成：

- R2 bucket f1-box-data 的 vendor/ 前缀已镜像 323 对象：constructors.json（187 队含 totals/传承/逐年）、drivers.json（917 人含车号/国籍/生日/家族/totals/逐年）、country-flags/（249+countries.json）、team-colors/（56 队 periods+colors 列表模型，冠军圈 38/38 满）、team-logos/（55 文件 38 身份，{id}@{year} 命名+logos.json，逐张目检）、tires/（shapes+compounds 2011–2026+manufacturers）、各目录 README、manifest.json、vendor/README.md。
- vendor/f1db/f1db-json-splitted.zip 保留为原始归档；data-sync action 只刷新它（合并后生效）。策展层手动镜像更新。
- 本地工作副本在 .data/vendor/（gitignore，非持久；R2 才是持久副本）。
- 分支/PR：feat/data-foundation → PR #6（contracts 类型+data-sync+文档）；feat/drivers-pages → PR #5（drivers 全局详情页等，未合并待用户审）；前端网格视觉 WIP 在 feat/drivers-pages 的 stash 里。
- 查找约定：colors(team,year) 区间+最老回退；logo(team,year) yearFrom<=year 最新、深底 white 浅底 color、缺 monogram；flag=countryId→countries.json→alpha2 svg。
- 许可：f1db CC-BY-4.0、flag-icons MIT、Fast-F1 MIT、商标/fair-use 仅标识性。

下一任务 #34：teams/{slug} 全局详情页，wiki 式逐年成绩表（年份/车手/积分/名次）+ 今年特写 + 生涯总计，视觉用 vendor 资产。注意：constructors.json 的 seasons 行目前无车手列表，wiki 表需要"每队每年车手"join（f1db seasons-entrants-drivers），实施时扩展 constructors.json 或现算。

2026-08-07 #34 完成（PR #7，待用户合并）：

- 架构转向：f1db 官方 SQLite 全量（30 表 + 18 视图，含 race_result/fastest_lap 比赛级视图）进了 Cloudflare D1（database f1db，id 50683ee9-c236-4bc5-bc11-4e8151916f54，APAC，约 42MB）。scripts/f1db-d1-dump.sh 按表拆分（建表序父表优先、剥事务语句）+ f1db-d1-import.sh 逐文件导入（约 25 分钟，data-sync timeout 45）。D1 坑：远端拒绝显式 BEGIN/COMMIT、外键默认开启、sqlite_master rowid 序即安全建表序。
- 绑定 env.F1_DB（wrangler.jsonc + wrangler.preview.jsonc 同一库）；DEV 无 D1，走 fixture apps/web/src/lib/fixtures/team-ferrari.json（真实数据生成，77 季 16 冠）。
- 2026-08-08 teams 体系切 f1db：/teams 索引列全 187 队，卡片只显示 logo/monogram 与名称；/{year}/teams 和 /{year}/teams/{team} 仅作兼容跳转，不再维护年份车队目录；vendor 查询走 getVendorIndexes 单次拉取（最新 logo、双色 hero）。DEV 只保留 constructors/team-ferrari 两个 fixture。用户决定：jolpica 不再用（directory 方案废弃，gen-directory 已删）；R2 v1/seasons 旧 payload 暂留——racing/results/drivers 页还在消费，迁移后删（#38）。logo 策展只留每队最新（44 个身份，缺失时留 monogram）；team-colors 为 56 队策展色；旧版本文件已从 R2 删除。wrangler dev --remote 连续请求会 403 限流（dev 专属），生产无此问题。两轮审查修复：COALESCE 全聚合（否则 172/187 队 500）、DNF 字面量、共享车按排名序 keep-first（ Fangio 1951 共享冠军曾显示 11）、多引擎变体积分累加、DSQ 名次不加 P 前缀、identity 并入单 batch、fixture 动态导入、race_data(constructor_id,type) 索引、data-sync release tag 门禁。D1 重导分钟级中断靠门禁收敛；blue-green 留待未来。待办 #38：赛季页迁 D1 退役 jolpica（用户定先不做）。
- 新增 /vendor/[...key] 路由：流式输出 R2 vendor/ 资产，键段白名单 [A-Za-z0-9@._-]，DEV 404。
- /teams/{slug} 详情页：身份头（双色 hero、最新 logo、Lineage 传承链徽章可点击、早期自身 stint 自动补）+ Season 面板（GP/Sprint）+ Team Summary + wiki 式逐场矩阵（P/F/冲刺排名上标、†、车手冠军金字、轮胎徽章、夺冠/当前 accent、将来轮次空列）。
- 预留未做：今年特写车手卡、视觉精修、车手链接（等 PR #5 全局车手页合并）。
- e2e 经验：astro dev toolbar 会注入额外 h1，选择器要限定 main 作用域。
