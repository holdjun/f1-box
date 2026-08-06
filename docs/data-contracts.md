# 数据契约（前端使用手册）

日期：2026-08-06
维护：ingest 管道生成，R2 存储（bucket f1-box-data，worker 绑定 env.F1_DATA）
设计依据：docs/superpowers/specs/2026-08-06-data-foundation-design.md

前端只读本文档描述的产物；不在访客请求中访问任何上游 API。所有产物经 packages/contracts 的解析器进入类型世界（边界校验一次，内部信任类型）。

## 读取方式

沿用 apps/web/src/lib/page-data.ts 模式：import.meta.env.DEV 用 fixture，生产用 createSeasonRepository(env.F1_DATA)。新增 repository 方法：

- getSeason(year)——现有，SeasonPayload（赛历/成绩/积分榜）。
- getDirectory(year)——v1/seasons/{year}/directory.json；缺失时返回 null，前端降级（无颜色/logo 信息）。
- getCountries() / getCircuits() / getCareer()——v1/global/*.json；缺失返回 null。
- getIndex()——现有，年份列表由 R2 listing 派生；回填新年份后自动出现，无需改代码。

manifest（latest.json）schema 不变；新产物走独立键，不经过 manifest。

## v1/seasons/{year}/directory.json

```ts
interface SeasonDirectory {
  schemaVersion: 1;
  season: number;
  generatedAt: string;              // ISO UTC
  sources: Source[];                // 署名：f1db (CC-BY-4.0) / Fast-F1 (MIT) / 官方资产
  teams: TeamEntry[];               // 该季参赛车队
  drivers: DriverEntry[];           // 该季车手身份
  entrants: EntrantEntry[];         // 阵容：车队→车手+轮次
}
interface TeamEntry {
  id: string;                       // f1db constructor id，如 red-bull
  name: string;                     // 与 SeasonPayload 的 constructorName 对齐
  fullName: string | null;
  countryId: string | null;         // 关联 countries.json
  color: string | null;             // hex，如 #3671c6；2018 前或无源为 null → 回退中性色
  logoKey: string | null;           // 仓库资产键（constructor id）；null → monogram 兜底
}
interface DriverEntry {
  id: string;                       // f1db driver id，如 george-russell
  code: string;                     // 三字母，RUS
  name: string;
  firstName: string;
  lastName: string;
  number: number | null;
  countryId: string | null;
  dateOfBirth: string | null;       // YYYY-MM-DD
  wikipediaUrl: string | null;
}
interface EntrantEntry {
  constructorId: string;
  name: string;
  drivers: { driverId: string; rounds: string | null; testDriver: boolean }[];
}
```

使用要点：

- 卡片颜色/ logo：teams.find(t => t.name === row.constructorName)，其中 row 来自 SeasonPayload 分类结果；颜色与 SeasonPayload 的"当季真实参赛关系"以 SeasonPayload 为准，directory 只提供展示元数据。
- 排序（按车队排名、队内相连）：用 SeasonPayload.constructorStandings 顺序 + driverStandings 位置；directory 不参与排序。
- 国籍显示：driver.countryId → countries.json 的 demonym 文案与 alpha2Code 旗标（emoji 或 SVG 皆可）。
- 车手详情 URL 建议改用 driver.id（slug 形态一致，如 /drivers/george-russell）；过渡期旧 slug 仍可匹配（id 与 name-slug 大部分同形）。

## v1/global/countries.json

```ts
interface Country { id: string; alpha2Code: string; alpha3Code: string; iocCode: string; name: string; demonym: string; }
```

替换现有手写 NATIONALITY_TO_ALPHA2/ALPHA3 表：demonym→alpha2Code 即"British→GB"。

## v1/global/circuits.json

```ts
interface Circuit {
  id: string; name: string; countryId: string | null; locality: string | null;
  latitude: number | null; longitude: number | null;
  lengthMetres: number | null; firstGrandPrix: number | null; numberOfLaps: number | null;
  lapRecord: { time: string; driverId: string | null; year: number | null } | null;
  svgKey: string | null;            // 赛道线稿资产键（资产落地前为 null）
}
```

与 SeasonPayload.events[].circuit 同义但 id 拼写不同（jolpica 下划线 albert_park，f1db 连字符 albert-park）；ingest 生成时已按"下划线→连字符"归一化写入 circuits.id，前端用同一归一化键 join。

## v1/global/career.json

```ts
interface CareerData {
  schemaVersion: 1;
  generatedAt: string;
  sources: Source[];
  drivers: DriverCareer[];
  constructors: ConstructorCareer[];
}
interface DriverCareer {
  id: string;
  totals: { grandsPrix: number; wins: number; podiums: number; poles: number; fastestLaps: number; points: number; championships: number; bestChampionshipPosition: number | null };
  seasons: { season: number; constructorId: string | null; position: number | null; points: number }[];
}
interface ConstructorCareer {
  id: string;
  totals: { grandsPrix: number; wins: number; podiums: number; poles: number; points: number; championships: number };
  chronology: { constructorId: string; yearFrom: number; yearTo: number | null }[];
}
```

详情页 Career 块改读此产物（f1db 全历史口径），不再用"我们有的赛季"现算；seasons 行可按 constructorId 着色（颜色查各年 directory，缺则中性）。

## 降级规则

任何新产物缺失/解析失败：console.error + 该能力降级（颜色中性、logo monogram、国旗白旗、Career 隐藏），页面主体（SeasonPayload 驱动）不受影响。不允许 503 整个页面。

## 署名

产物 sources 含 f1db（CC-BY-4.0）与 Fast-F1（MIT）。前端切片需在页脚展示数据署名（"Data: f1db (CC BY 4.0), Jolpica (CC BY-NC-SA 4.0)" 量级文案），本轮不实施。
