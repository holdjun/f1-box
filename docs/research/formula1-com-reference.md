# formula1.com 官方信息架构与页面设计参考

> 调研日期：2026-08-05（Asia/Shanghai）  
> 抓取范围：formula1.com 公开页面，使用渲染后的浏览器 DOM 观察页面结构、文字、链接、图片与交互控件。  
> 目标：为“年份为顶层作用域，下面分 racing / results / drivers / teams”的多赛季 F1 数据站点提供信息架构和组件参考。  
> 说明：页面内容、赛季积分和下一场赛事会随时间变化；本文记录的是本次抓取时的可见状态。

## 1. 调研页面与截图交接

| 页面 | URL | 用途 | 截图文件 |
|---|---|---|---|
| 赛季主页 | `https://www.formula1.com/en/racing/2026` | 赛季进程、已结束比赛、未来比赛、下一场 | `racing-2026.png` |
| Races 成绩 | `https://www.formula1.com/en/results/2026/races` | 赛历结果表 | `results-races.png` |
| Drivers 成绩 | `https://www.formula1.com/en/results/2026/drivers` | 车手积分表 | `results-drivers.png` |
| Teams 成绩 | `https://www.formula1.com/en/results/2026/team` | 车队积分表 | `results-team.png` |
| 车手列表 | `https://www.formula1.com/en/drivers` | 当季车手网格 | `drivers-grid.png` |
| 车手详情 | `https://www.formula1.com/en/drivers/max-verstappen` | 车手统计、履历、内容 | `driver-verstappen.png` |
| 车队列表 | `https://www.formula1.com/en/teams` | 当季车队网格 | `teams-grid.png` |
| 车队详情 | `https://www.formula1.com/en/teams/ferrari` | 车队、车手、统计、历史 | `team-ferrari.png` |

截图交接目录：

`/Users/hj/Documents/Codex/2026-07-20/wo/f1-box/docs/research/shots/`

本次人工截图已整理为：`racing-2026.png`、`results-races.png`、`results-drivers.png`、`results-team.png`、`drivers-grid.png`、`teams-grid.png`。另外保留了补充页面：`awards-fastest-pit-stop.png`、`race-result-china.png`、`driver-lando-norris.png`、`driver-george-russell.png`、`team-mercedes.png`。

当前没有与指定 URL 完全对应的 Max Verstappen 和 Ferrari 详情截图，因此没有用其他车手/车队截图冒充：`driver-verstappen.png`、`team-ferrari.png` 暂缺。之前自动生成的拼接截图和 `racing-2026-top.png` 已从交接目录移出，不再作为产物使用。

本文不依赖原始 HTML。

## 2. 全站信息架构

### 2.1 顶部全局导航

页面顶部是两层导航：

1. 第一层为商业/账户工具栏：`Race Series` 下拉、`Authentics`、`Store`、`Tickets`、`Hospitality`、`Experiences`、`Arcade`、`F1 TV`、`Sign In`、`Subscribe`。
2. 第二层为站点主导航：F1 Logo、`Schedule`、`Results`、`Standings`、`Drivers`、`Teams`、`F1 Unlocked`，以及 `Open menu` 和 FIA 外链。
3. 滚动页面时主导航和 Event Tracker 组合成 sticky header；它会持续显示当前赛事上下文，例如 `R12 | 21 - 23 Aug | Netherlands`。

主导航的核心路由：

| 导航项 | 路由 |
|---|---|
| Schedule | `/en/racing/2026` |
| Results | `/en/results/2026/races` |
| Standings | `/en/results/2026/drivers` |
| Drivers | `/en/drivers` |
| Teams | `/en/teams` |
| F1 Unlocked | `/en/page/unlocked` |

### 2.2 年份作为作用域

- `racing` 和 `results` 页面把年份直接放在路径中：`/en/racing/{year}`、`/en/results/{year}/{category}`。
- `racing/{year}` 页面有 `2026` 圆角按钮，打开 `Season` 菜单；本次可见年份为 `2018`–`2026`，点击年份直接进入 `/en/racing/{year}`。
- `results/{year}/{category}` 页面同样有 `2026` 按钮，打开可滚动年份列表，范围为 `1950`–`2026`。切换年份后保留当前结果分类，例如 `/en/results/2025/races`。
- `/en/drivers`、`/en/teams` 不在 URL 中显式带年份，但页面标题和数据内容显示当前赛季 `2026`；因此它们更像“当前赛季实体目录”，而非完整历史目录。
- 详情页 `/en/drivers/{slug}`、`/en/teams/{slug}` 也默认展示当前赛季数据；详情中的 `Full season results` 再跳到带年份的 results 路由。

### 2.3 结果中心的页内导航

结果页顶部有同一组 tab：

| Tab | 路由 |
|---|---|
| Races | `/en/results/{year}/races` |
| Drivers | `/en/results/{year}/drivers` |
| Teams | `/en/results/{year}/team` |
| Awards | `/en/results/{year}/awards/fastest-laps` |

页面内另有一个 `All` 选择器：

- Races 页按比赛筛选，选项是 `All` 和各场 Grand Prix；
- Drivers 页按车手筛选，选项为 `All` 和 `Surname, Given name`；
- Teams 页按车队筛选，选项为 `All` 和车队名。

### 2.4 URL 关系总表

| 层级 | URL 模式 | 典型链接 | 关系 |
|---|---|---|---|
| 赛季主页 | `/en/racing/{year}` | `/en/racing/2026` | 年份 → 该赛季赛历 |
| 单场赛事 | `/en/racing/{year}/{race-slug}` | `/en/racing/2026/netherlands` | 赛历卡 → 赛事周末页 |
| 结果分类 | `/en/results/{year}/{category}` | `/en/results/2026/races` | 年份 → Races / Drivers / Teams |
| 单场正赛结果 | `/en/results/{year}/races/{race-id}/{race-slug}/race-result` | `/en/results/2026/races/1280/china/race-result` | Races 表行/筛选项 → 完整比赛结果 |
| 车手赛季结果 | `/en/results/{year}/drivers/{driver-code}/{driver-slug}` | `/en/results/2026/drivers/MAXVER01/max-verstappen` | 车手卡、积分表车手名 → 该赛季结果 |
| 车队赛季结果 | `/en/results/{year}/team/{team-name}` | `/en/results/2026/team/Ferrari` | 车队卡、积分表车队名 → 该赛季结果 |
| 车手目录 | `/en/drivers` | `/en/drivers` | 当前赛季车手网格 |
| 车手详情 | `/en/drivers/{driver-slug}` | `/en/drivers/max-verstappen` | 车手目录卡 → 车手详情 |
| 车队目录 | `/en/teams` | `/en/teams` | 当前赛季车队网格 |
| 车队详情 | `/en/teams/{team-slug}` | `/en/teams/ferrari` | 车队目录卡 → 车队详情 |
| 详情页内部区块 | `/{detail}#statistics`、`#biography` 等 | `/en/drivers/max-verstappen#statistics` | 详情页 tab → 页内锚点 |

实体之间的交叉链接关系：

```text
/en/racing/{year}
  └─ 赛事卡 → /en/racing/{year}/{race-slug}
                    └─ 赛事结果入口 → /en/results/{year}/races/{race-id}/{race-slug}/race-result

/en/results/{year}/drivers
  ├─ Driver → /en/results/{year}/drivers/{driver-code}/{driver-slug}
  └─ Team   → /en/results/{year}/team/{team-name}

/en/drivers/{driver-slug}
  ├─ All drivers → /en/drivers
  └─ Full season results / Results archive → /en/results/{year}/drivers/{driver-code}/{driver-slug}

/en/teams/{team-slug}
  ├─ All teams → /en/teams
  ├─ 两名车手 → /en/drivers/{driver-slug}
  └─ Full season results / Results archive → /en/results/{year}/team/{team-name}
```

### 2.5 页脚

主要区块包括 `OUR PARTNERS` 合作伙伴 Logo 墙、官方 F1 App 下载横幅、`Quick Links`、`Legal & compliance`、`Support & corporate`、`Community & content`、社交媒体和版权信息。页脚不是数据页面主体，但会影响整页截图高度和视觉节奏。

## 3. 页面逐页拆解

## 3.1 赛季主页 `/en/racing/2026`

### 用途

展示一个赛季的完整赛历状态：已结束赛事结果、下一场比赛、未来比赛、季前测试和赛季末赛事。顶部 Event Tracker 给出下一场比赛和当地/用户时间。

### 从上到下的版块顺序

1. Global top bar 与主导航。
2. Event Tracker：当前轮次 `R12`、日期 `21 - 23 Aug`、国旗、`Next Race: Netherlands`、`MY TIME` / `TRACK TIME` 时钟。
3. 年份选择器 `2026`。
4. H1：`2026 FIA Formula One World Championship™ Race Calendar 2026`。
5. `Add F1 calendar` 按钮。
6. 赛季开场上下文：`Previous`、`Next`、`Upcoming` 三个小状态，分别指向 Hungary、Netherlands、Italy。
7. 季前测试卡：Bahrain 的 `FORMULA 1 ARAMCO PRE-SEASON TESTING 1 2026` 和 `...TESTING 2 2026`。
8. 已结束比赛卡片：Round 1–11，每张含前三名和时间/间隔。
9. 下一场卡片：Round 12 Netherlands，红色高亮并标记 `NEXT RACE`。
10. 未来比赛卡片：Round 13 以后，显示国旗、日期和赛道轮廓；不显示结果。
11. 赛季年份列表/上一赛季入口。
12. 合作伙伴 Logo 墙、App 下载、页脚。

### 比赛卡字段

| 状态 | 展示字段 | 示例 |
|---|---|---|
| 已结束 | Round、日期、国家/城市、官方 Grand Prix 全名、P1/P2/P3、车手缩写、完赛时间或与第一名间隔 | `ROUND 1` / `Australia` / `FORMULA 1 QATAR AIRWAYS AUSTRALIAN GRAND PRIX 2026` / `1st RUS 1:23:06.801` |
| 下一场 | Round、`NEXT RACE`、国旗、国家、官方 Grand Prix 全名、比赛周末日期、赞助商 Logo | `ROUND 12` / `NEXT RACE` / `Netherlands` / `21 - 23 AUG` |
| 未开始 | Round、国旗、国家、官方 Grand Prix 全名、比赛周末日期、赛道轮廓 | `ROUND 15` / `Azerbaijan` / `24 - 26 SEP` |
| 测试 | `TESTING`、国旗、地点、测试名称、日期、测试图 | `FORMULA 1 ARAMCO PRE-SEASON TESTING 1 2026` |

前三名区域使用小型圆形车手头像、车手三字母缩写和成绩；已结束卡片没有完整车手姓名，但点击卡片进入赛事详情页。

### 交互

- 年份下拉：按钮打开 `menu Season`，选择年份导航到对应赛季。
- `Add F1 calendar`：加入日历的行动入口。
- 赛事卡整体可点击；路由为 `/en/racing/2026/{race-slug}`，例如 `/en/racing/2026/australia`。
- Event Tracker 中下一场赛事可点击；时间组件有用户时间和赛道时间。
- 页面使用 sticky header；赛事卡和赞助商 Logo 有 hover/点击反馈，但没有发现独立的统计图表。

### 图片

- 赛道/赛事卡主图：`media.formula1.com/.../static-assets/2026/races/card/{slug}.webp`。
- 赞助商 Logo：例如 `common/f1/logo/aws/logoawswhite.webp`、`.../heineken/logoheinekenwhite.webp`。
- 已结束赛事前三名：2026 车手透明背景图，典型路径为 `common/f1/2026/{team}/{driver-code}/2026{team}{driver-code}right.webp`。
- 未来赛事：国旗 SVG 和赛道轮廓图。

## 3.2 Races 成绩页 `/en/results/2026/races`

### 用途与版块顺序

1. Global header / Event Tracker。
2. 结果页顶部广告 iframe（内容可能随请求变化）。
3. 年份选择器 `2026`。
4. 结果 tab：`Races`、`Drivers`、`Teams`、`Awards`。
5. 比赛筛选器 `All`。
6. H1：`2026 RACE RESULTS`。
7. Races 表格。
8. 页脚。

### 表格

表名：`2026 RACE RESULTS`  
每行代表一场已经完成的 Grand Prix。

| 原样列头 | 含义 | 示例 |
|---|---|---|
| `GRAND PRIX` | 比赛名称，带国旗；点击进入该场完整比赛结果 | `Australia` |
| `DATE` | 比赛日期 | `08 Mar` |
| `WINNER` | 正赛冠军 | `George Russell` |
| `TEAM` | 冠军所属车队 | `Mercedes` |
| `LAPS` | 正赛完成圈数 | `58` |
| `TIME` | 冠军完赛时间 | `1:23:06.801` |

示例行：

| GRAND PRIX | DATE | WINNER | TEAM | LAPS | TIME |
|---|---|---|---|---:|---|
| Australia | 08 Mar | George Russell | Mercedes | 58 | 1:23:06.801 |
| China | 15 Mar | Kimi Antonelli | Mercedes | 56 | 1:33:15.607 |

### 路由与交互

- 比赛单元：`/en/results/2026/races/{race-id}/{slug}/race-result`，例如 `/en/results/2026/races/1279/australia/race-result`。
- 年份选择器保留当前 category：选择 2025 会进入 `/en/results/2025/races`。
- `All` 打开比赛列表，每项带国旗并跳到该场 race-result。
- 表格行在视觉上是横向数据表，移动端需考虑横向压缩或卡片化。

## 3.3 Drivers 成绩页 `/en/results/2026/drivers`

### 用途与版块顺序

Global header / Event Tracker → 年份选择器 → Races/Drivers/Teams/Awards tab → `All` 车手筛选 → H1 `2026 DRIVERS' STANDINGS` → 车手排名表 → 页脚。

### 表格

表名：`2026 DRIVERS' STANDINGS`  ；每行代表一位车手在所选赛季的车手积分排名。

| 原样列头 | 含义 | 示例 |
|---|---|---|
| `POS.` | 当前排名 | `1` |
| `DRIVER` | 车手姓名，点击进入该车手的赛季结果 | `Kimi Antonelli` |
| `NATIONALITY` | 三字母国籍代码 | `ITA` |
| `TEAM` | 当前所属车队，点击进入车队赛季结果 | `Mercedes` |
| `PTS.` | 赛季积分 | `219` |

示例行：

| POS. | DRIVER | NATIONALITY | TEAM | PTS. |
|---:|---|---|---|---:|
| 1 | Kimi Antonelli | ITA | Mercedes | 219 |
| 2 | Lewis Hamilton | GBR | Ferrari | 169 |

### 路由与交互

- 车手链接：`/en/results/2026/drivers/{driver-code}/{slug}`，例如 `/en/results/2026/drivers/ANDANT01/kimi-antonelli`。
- 车队链接：`/en/results/2026/team/{team-name}`，例如 `/en/results/2026/team/Mercedes`。
- `All` 筛选项按姓氏字母顺序列出，例如 `Albon, Alexander`、`Verstappen, Max`。
- 车手头像与车队 Logo 出现在行内，头像为透明背景人物图，Logo 为白色/透明 Logo。

## 3.4 Teams 成绩页 `/en/results/2026/team`

### 用途与版块顺序

Global header / Event Tracker → 年份选择器 → Races/Drivers/Teams/Awards tab → `All` 车队筛选 → H1 `2026 TEAMS' STANDINGS` → 车队排名表 → 页脚。

### 表格

表名：`2026 TEAMS' STANDINGS`；每行代表一支车队在所选赛季的车队积分排名。

| 原样列头 | 含义 | 示例 |
|---|---|---|
| `POS.` | 当前车队排名 | `1` |
| `TEAM` | 车队名称与 Logo | `Mercedes` |
| `PTS.` | 车队积分 | `379` |

示例行：

| POS. | TEAM | PTS. |
|---:|---|---:|
| 1 | Mercedes | 379 |
| 2 | Ferrari | 307 |

### 路由与交互

- 车队链接：`/en/results/2026/team/{team-name}`，例如 `/en/results/2026/team/Ferrari`。
- `All` 打开车队列表并跳到对应赛季车队结果。
- 行内主要视觉元素是车队 Logo；没有在该页面发现跨赛季折线图或柱状图。

## 3.5 车手列表 `/en/drivers`

### 用途与版块顺序

1. Global header / Event Tracker。
2. H1：`F1 DRIVERS 2026`。
3. 引导文案：`Find the current Formula 1 drivers for the 2026 season`。
4. 车手卡网格，共 22 位当前车手。
5. `F1 HALL OF FAME` 引导区。
6. 合作伙伴与页脚。

### 车手卡字段

- 车手名字：Given name + Family name；例如 `George Russell`。
- 所属车队：例如 `Mercedes`。
- 车手透明背景肖像/赛车服图；列表卡不显示国旗、车号和积分。
- 整张卡跳转到 `/en/drivers/{slug}`，例如 `/en/drivers/max-verstappen`。
- 列表顺序按当前站点展示顺序，不是严格按积分排名；2026 样例前几项为 George Russell、Kimi Antonelli、Charles Leclerc、Lewis Hamilton。

## 3.5.1 补充：单场正赛结果 `/en/results/2026/races/1280/china/race-result`

本次人工截图还覆盖了 China 赛事结果页。它是 Races 汇总表的下钻页面，结构为：Global header / Event Tracker → 年份选择器 → 结果分类 tab → 赛事选择器 `China` → session 选择器 `Race Result` → 比赛标题、日期、赛道 → 结果表。

结果表原样列头：`POS.`、`NO.`、`DRIVER`、`TEAM`、`LAPS`、`TIME / RETIRED`、`PTS.`。每行代表一位车手在该场正赛中的最终结果。

示例：`1 | 12 | Kimi Antonelli | Mercedes | 56 | 1:33:15.607 | 25`；`2 | 63 | George Russell | Mercedes | 56 | +5.515s | 18`。

页内选择器可在不同 Grand Prix 和不同 session 间切换；这是“赛季 → 赛事 → 场次”的三级导航模型。推荐自有站点沿用该层级，并把 `race-result` 扩展为 `qualifying`、`sprint`、`fastest-laps` 等稳定 slug。

## 3.5.2 补充：Awards 页面

结果 tab 的 `Awards` 进入 `/en/results/{year}/awards/{award-slug}` 路由族。本次截图展示了 `DHL Fastest Pit Stop` 页面：年份与结果 tab 位于顶部，下面是 Award 选择器，选项包括 `DHL Fastest Lap`、`DHL Fastest Pit Stop`、`Salesforce Driver of the Day`、`Pirelli Pole Position`；主体为 Award 说明横幅和 `Related Videos` 横向视频卡。

这个页面说明 Results 不只是三张积分/成绩表，还可以承载按年份的奖项类数据；如果自有站点暂不实现，建议至少在 URL 和 tab 设计上预留 `awards`。

## 3.6 车手详情 `/en/drivers/max-verstappen`

### 用途与版块顺序

1. Global header / Event Tracker。
2. `All drivers` 返回链接。
3. 页内 tab：`Statistics`（默认选中）、`Biography`、`News`。
4. 车手 hero：姓名 `Max Verstappen`、国籍 `Netherlands`、车队 `Red Bull Racing`、车号 `3`、`Shop now`。
5. `STATISTICS`：`2026 SEASON` 与 `CAREER STATS`。
6. `Full season results` 与 `Results archive`。
7. `Biography`：出生信息、引语、传记正文和 3 张图片的轮播。
8. `Related Videos` 横向内容轮播。
9. `Related Articles` 列表。
10. 合作伙伴与页脚。

### 统计字段

#### 2026 SEASON

| 字段 | 本次示例 |
|---|---:|
| Season Position | 6th |
| Season Points | 109 |
| Grand Prix Races | 11 |
| Grand Prix Points | 100 |
| Grand Prix Wins | 0 |
| Grand Prix Podiums | 4 |
| Grand Prix Poles | 0 |
| Grand Prix Top 10s | 8 |
| DHL Fastest Laps | 1 |
| DNFs | 3 |
| Sprint Races | 4 |
| Sprint Points | 9 |
| Sprint Wins | 0 |
| Sprint Podiums | 0 |
| Sprint Poles | 0 |
| Sprint Top 10s | 4 |

#### CAREER STATS

| 字段 | 本次示例 |
|---|---:|
| Grands Prix Entered | 244 |
| Career Points | 3553.5 |
| Highest Race Finish | 1 (x71) |
| Podiums | 131 |
| Highest Grid Position | 1 (x48) |
| Pole Positions | 48 |
| World Championships | 4 |
| DNFs | 36 |

### 历史/图表观察

- 本页没有发现 SVG/canvas 形式的车手生涯折线图、赛季积分曲线或坐标轴图表。
- “生涯历史”主要由 Career Stats 数字摘要、Biography 长文本、3 张图片轮播、相关视频和文章组成。
- 因此如果重设计需要做可视化，可将该信息架构扩展为“按赛季的排名/积分折线图 + 按比赛的完赛名次条带”，但这属于自有站点增强，不是本次页面直接呈现的官方组件。

### 交互

- `Statistics / Biography / News` 是锚点 tab，路由使用 `#statistics`、`#biography`、`#news`。
- Biography 图片轮播有 `Previous image`、`1/3`、`Next image` 和描述按钮。
- Related Videos 是横向轮播，有 `Previous`、`Next`，卡片含缩略图、播放图标、时长、标题。
- `Full season results`：`/en/results/2026/drivers/MAXVER01/max-verstappen`。
- `Results archive` 使用同一结果归档路由（站点实际链接带完整域名）。

## 3.7 车队列表 `/en/teams`

### 用途与版块顺序

Global header / Event Tracker → H1 `F1 TEAMS 2026` → 引导文案 → 11 支车队网格 → `2026 F1 DRIVERS` 引导区 → 合作伙伴与页脚。

### 车队卡字段

- 车队名称，例如 `Mercedes`、`Ferrari`、`Red Bull Racing`。
- 两名当季车手的姓名，例如 `George Russell`、`Kimi Antonelli`。
- 两张小尺寸车手透明背景图。
- 车队 Logo。
- 车队赛车渲染图/车身图，在列表卡中作为大图背景或卡片视觉主体。
- 整张卡跳转到 `/en/teams/{slug}`，例如 `/en/teams/ferrari`。

列表顺序样例：Mercedes、Ferrari、McLaren、Red Bull Racing、Racing Bulls、Alpine、Haas、Audi、Williams、Aston Martin、Cadillac。

## 3.8 车队详情 `/en/teams/ferrari`

### 用途与版块顺序

1. Global header / Event Tracker。
2. `All teams` 返回链接。
3. 页内 tab：`Drivers`（默认选中）、`Statistics`、`Profile`、`News`。
4. 车队 hero：Ferrari Logo、车队名称、两名车手、`Shop now`。
5. `DRIVERS`：Charles Leclerc、Lewis Hamilton 两张车手卡。
6. `STATISTICS`：`2026 SEASON` 与 `TEAM SUMMARY`。
7. `Full season results` 与 `Results archive`。
8. `TEAM PROFILE`：车队基础信息与历史正文。
9. 历史图集轮播，6 张图片。
10. `Related Videos` 横向轮播。
11. `Related Articles` 列表。
12. 合作伙伴与页脚。

### 2026 SEASON 字段

| 字段 | 本次示例 |
|---|---:|
| Season Position | 2nd |
| Season Points | 307 |
| Grand Prix Races | 11 |
| Grand Prix Points | 268 |
| Grand Prix Wins | 2 |
| Grand Prix Podiums | 9 |
| Grand Prix Poles | 0 |
| Grand Prix Top 10s | 20 |
| DHL Fastest Laps | 2 |
| DNFs | 2 |
| Sprint Races | 4 |
| Sprint Points | 39 |
| Sprint Wins | 0 |
| Sprint Podiums | 4 |
| Sprint Poles | 1 |
| Sprint Top 10s | 8 |

### TEAM SUMMARY 字段

| 字段 | 本次示例 |
|---|---:|
| Grands Prix Entered | 1134 |
| Team Points | 10982 |
| Highest Race Finish | 1 (x251) |
| Podiums | 647 |
| Highest Grid Position | 1 (x254) |
| Pole Positions | 254 |
| World Championships | 16 |

### TEAM PROFILE 字段

| 字段 | 本次示例 |
|---|---|
| Full Team Name | Scuderia Ferrari HP |
| Base | Maranello, Italy |
| Team Chief | Frédéric Vasseur |
| Technical Chief | Loic Serra / Enrico Gualtieri |
| Chassis | SF-26 |
| Power Unit | Ferrari |
| Reserve Driver | Antonio Giovinazzi |
| First Team Entry | 1950 |

### 历史/图表观察

- 本页没有发现车队历年成绩的折线图、柱状图、坐标轴或可交互年份数据图。
- “车队历年成绩”实际呈现为 `TEAM SUMMARY` 数字摘要 + `TEAM PROFILE` 历史介绍 + 按年份分段的文字（本次可见 `2025`、`2024`）+ 图片轮播。
- 页面有 6 张历史/车手相关图片的 carousel，但不是数据可视化。
- 重设计建议：保留官方“数字摘要 + 历史正文”的层级，同时补充按年份的 constructors position / points 折线图；每个点可点击打开该年的 `/en/results/{year}/team/Ferrari`。

## 4. 图片与媒体资源参考

### 4.1 已下载的官方参考资产

目录：`/Users/hj/Documents/Codex/2026-07-20/wo/f1-box/docs/research/assets/`

| 本地文件 | 用途 |
|---|---|
| `race-card-hungary.webp` | 已结束赛事卡主图 |
| `race-card-netherlands.webp` | 下一场赛事卡主图 |
| `driver-max-verstappen.webp` | 车手详情 hero 人物图 |
| `driver-george-russell.webp` | 车手列表卡人物图示例 |
| `team-ferrari-car.webp` | 车队详情 hero 赛车图 |
| `team-ferrari-logo.webp` | Ferrari Logo |
| `team-ferrari-leclerc.webp` | Ferrari 车手卡 |
| `team-ferrari-hamilton.webp` | Ferrari 车手卡 |
| `team-mercedes-logo.webp` | 成绩表车队 Logo |
| `video-ferrari-history.jpeg` | 车队历史内容卡缩略图 |

这些资产来自公开页面在本次抓取时返回的官方媒体域名，仅作为内部设计调研参考；正式产品使用前应单独确认版权、授权和热链策略。

### 4.2 典型官方 URL

```text
# 赛道/赛事卡
https://media.formula1.com/image/upload/c_lfill,w_720/q_auto/v1740000001/fom-website/static-assets/2026/races/card/hungary.webp

# 下一场赛事卡
https://media.formula1.com/image/upload/c_lfill,w_1296/q_auto/v1740000001/fom-website/static-assets/2026/races/card/netherlands.webp

# 车手透明背景图
https://media.formula1.com/image/upload/c_lfill,w_440/q_auto/d_common:f1:2026:fallback:driver:2026fallbackdriverright.webp/v1740000001/common/f1/2026/mercedes/georus01/2026mercedesgeorus01right.webp

# 车队 Logo
https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000001/common/f1/2026/mercedes/2026mercedeslogowhite.webp

# 车队赛车图
https://media.formula1.com/image/upload/c_lfill,w_3392/q_auto/v1740000001/common/f1/2026/ferrari/2026ferraricarright.webp
```

### 4.3 图片角色清单

| 图片角色 | 出现位置 | 设计作用 |
|---|---|---|
| F1 Logo / FIA Logo | 全局 header | 品牌与官方背书 |
| 国旗 | Event Tracker、赛事卡、成绩表、详情统计 | 快速识别国家/国籍 |
| 赛道照片 | racing 赛事卡 | 将赛历变成视觉内容，而不只是日期列表 |
| 赛道轮廓 | 未开始赛事卡 | 在没有比赛结果和照片时提供识别符号 |
| 车手透明人物图 | 比赛前三名、车手卡、车队卡、详情 hero | 人物识别、排名视觉化 |
| 车队 Logo | 成绩表、车队卡、详情 hero | 车队品牌识别 |
| 赛车渲染图 | 车队列表/详情 | 形成车队差异化的主视觉 |
| 新闻/视频缩略图 | 详情页底部 | 将统计页连接到内容生态 |
| 赞助商 Logo | 赛事卡、页脚合作伙伴区 | 官方商业品牌露出 |

## 5. 复用组件清单

### 导航与作用域

- Global top bar。
- 主导航 + active tab。
- sticky Event Tracker。
- 年份选择器：赛季菜单、结果页历史年份菜单。
- 结果分类 tab：Races / Drivers / Teams / Awards。
- `All` 筛选下拉/对话框。

### 数据组件

- 赛历卡：测试、已结束、下一场、未来赛事四种状态。
- 成绩表：国家/旗帜、日期、胜者、车队、圈数、时间。
- 车手积分表：排名、姓名、国籍、车队、积分。
- 车队积分表：排名、车队、积分。
- 车手/车队统计 Definition List：字段名 + 数值，按赛季和生涯/团队摘要分组。
- 车手卡：姓名、车队、透明人物图、内部路由。
- 车队卡：车队名、两名车手、车手小图、Logo、赛车图。

### 内容与媒体组件

- Hero 车手/车队区。
- 图片 carousel：上一张、下一张、计数器、描述按钮。
- 视频 carousel：播放图标、时长、标题。
- 相关文章列表。
- 合作伙伴 Logo 墙。
- App 下载横幅。

## 6. 面向多赛季 F1 数据站点的建议 IA

推荐把年份作用域明确到一级导航或页面顶部：

```text
/{year}
├── racing
│   ├── /{year}/racing
│   └── /{year}/racing/{race-slug}
├── results
│   ├── /{year}/results/races
│   ├── /{year}/results/races/{race-id}/{race-slug}
│   ├── /{year}/results/drivers
│   ├── /{year}/results/drivers/{driver-id}/{driver-slug}
│   ├── /{year}/results/teams
│   └── /{year}/results/teams/{team-slug}
├── drivers
│   ├── /{year}/drivers
│   └── /{year}/drivers/{driver-slug}
└── teams
    ├── /{year}/teams
    └── /{year}/teams/{team-slug}
```

与官方站点相比，这种方案将 `/drivers` 和 `/teams` 也纳入年份作用域，更适合多赛季数据站点；详情页仍可提供“当前车手/车队”默认快捷入口。

### 年份切换建议

- 桌面端：顶部固定显示当前年份，例如 `2026`；点击后打开可搜索/滚动的年份菜单。
- 结果页：切换年份后保留当前分类，避免用户从 Drivers 切换年份后被送回 Races。
- racing 页：切换年份后保留赛历页，并在顶部显示该赛季的当前进度。
- 详情页：提供 `Season` 选择器和 `Career`/`All seasons` 入口，避免把当前赛季数据与生涯数据混在同一层。

## 7. 数据可视化总结

本次 8 个页面中，官方页面实际使用的可视化/视觉数据组件主要是：

1. 赛历时间线式卡片流：通过 `Previous / Next / Upcoming`、Round、日期、卡片状态表达赛季进程。
2. 赛事前三名结果条：P1/P2/P3 + 车手缩写 + 完赛时间/间隔 + 车手小图。
3. 赛道轮廓图：用于尚未开始的未来赛事。
4. 国旗和车队 Logo：作为表格、卡片和详情页的快速识别符号。
5. 数字统计摘要：车手赛季/生涯、车队赛季/团队摘要；采用字段-数值两列式布局。
6. 图片/视频 carousel：属于媒体浏览组件，不是数据图表。

没有观察到以下官方数据图表：

- 车手按赛季积分变化折线图；
- 车手按比赛完赛名次图；
- 车队跨年度 constructors points / position 图；
- 带 X/Y 坐标轴、图例和 tooltip 的 SVG/canvas 统计图。

因此，重设计时最值得补充的两类图表是：

- 车手生涯：X 轴为赛季或比赛轮次，Y 轴为积分/排名；支持按 `Grand Prix` / `Sprint` 切换，并在 tooltip 中显示车队。
- 车队历史：X 轴为年份，Y 轴可切换 `Championship position`、`Team points`、`Podiums`；每条线对应车队，点击年份进入该年的车队结果页。

## 8. 抓取与异常记录

- 8 个指定 URL 均能完成公开访问和 JS 渲染，未遇到登录墙、验证码或反爬拦截。
- 页面包含广告 iframe，广告图片和链接会因时间/地域变化，不应作为数据站点 IA 的核心参考。
- 站点内容存在动态时间信息：Event Tracker 的 `MY TIME`、`TRACK TIME`、下一场比赛和积分会随访问时刻变化。
- 站点的图片 URL 使用 Cloudinary 风格的裁剪参数（例如 `c_lfill,w_440`、`q_auto`）；正式实现建议在自己的媒体层保存语义化字段，不把第三方裁剪 URL 当作稳定主键。
