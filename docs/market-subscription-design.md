# SuperPoE2 集市实时购买目标监控与游戏内机会面板详细设计

> 状态：Phase O0-O4 已实现；保存的搜索、购买目标、机会中心已拆分，待双区服登录、断网/限流、DPI/多显示器长时实机验收

## 全局交易中心

集市、装备仓库、通货行情和实时监控统一收敛到全局唯一的“交易中心”界面，构筑编辑器不再嵌入重复的集市或监控实例。交易中心包含“集市与仓库”“通货行情”和“实时监控”三个 Tab；通货行情读取第三方批量汇总且只提供查询，详细方案见 [currency-market-design.md](./currency-market-design.md)。后续仍可独立增加查价、交易记录等交易域功能。

构筑中心和构筑编辑器只提供交易中心入口。进入时记录来源，返回时恢复原构筑或构筑中心，不重置未保存的构筑状态。普通入口保留上次使用的交易 Tab；置顶机会窗口的“实时监控”入口始终直达实时监控 Tab。
> 更新日期：2026-08-01
> 适用项目：`D:\sources\superpoe`
> 关联设计：[marketplace-browser-design.md](./marketplace-browser-design.md)、[price-check-design.md](./price-check-design.md)

## 1. 产品定义

本功能不是通用通知中心，也不是把官方搜索结果持续复制到一个列表。保存搜索只表达“以后还要复用这组条件”；用户基于它创建购买目标后，才表达一个持续监控意图：

```text
我正在等待符合这些条件的装备。
出现机会时尽快告诉我。
帮助我在游戏中快速判断并主动尝试。
当我买到、不再需要或暂时不想等待时停止监控。
```

官方 Trade2 Live WebSocket 只能说明新 listing 刚被发布，不能保证卖家仍在线、listing 仍有效、藏身处请求成功或用户最终买到装备。SuperPoE2 的产品承诺是：

> 尽可能早地发现符合条件的新挂单，校验并优先展示更值得立即处理的机会，缩短用户从发现到主动尝试的时间。

不得使用“已找到可购买装备”“抢购成功”等无法证明的文案。推荐使用“刚发现新挂单”“尝试前往”“已发送藏身处请求”“可能已被其他玩家抢先”。

## 2. 设计原则

1. 低延迟优先：不能等待全部命中详情完成后才提示第一条可操作机会。
2. 降低判断成本：游戏中用固定窗口展示可操作队列和所选装备的完整词缀；完整历史留在应用内机会中心。
3. 明确不确定性：区分刚检测、正在校验、可尝试、已失效和已尝试。
4. 用户主动操作：不自动前往藏身处、不自动私聊、不自动购买。
5. 抗突发：瞬间大量 listing 只产生一次提醒，并经过合并、限流、校验和排序。
6. 任务级控制：用户可以暂停或完成某个购买目标，不影响其他目标。
7. 展示与管理分离：游戏机会面板负责快速判断和行动，SuperPoE2 主界面负责完整管理、设置和历史。
8. 安全降级：机会面板、声音或页面增强失败不能影响 Live 连接、历史落盘、官方集市和装备仓库。

## 3. 产品边界

### 3.1 包含

- 将已保存的官方搜索启用为购买目标。
- 国服和国际服官方 Trade2 Live WebSocket。
- 多目标优先级、连接状态、暂停、恢复和完成。
- 突发事件合并、listing 去重、有限批量 Fetch、机会校验和排序。
- 应用内短期机会历史和未处理数量。
- 与查价器共用的 Windows 游戏窗口识别。
- 游戏前台时的置顶机会面板和可配置提示音。
- 用户主动尝试前往藏身处。

### 3.2 不包含

- Windows、macOS 或 Electron 系统通知。
- 自动前往藏身处、自动私聊、自动购买、自动循环尝试下一件。
- 价格变化、卖家在线状态或 listing 下架的后台轮询。
- 绕过登录、验证码、限流、连接数限制或官方接口策略。
- DLL 注入、DirectX Hook、游戏内存读取或独占全屏覆盖。
- 把所有 Live result 自动收藏到装备仓库。

## 4. 保存的搜索与购买目标

购买目标建立在可用、可验证、可恢复的保存搜索之上，但两者是独立实体。删除或编辑保存搜索不能静默删除、暂停或改变正在运行的购买目标。

### 4.1 当前实现缺口

当前 `SavedMarketSearch` 只保存 `realm + name + note + url + folderId`，UI 通过两个 `window.prompt()` 取得名称和备注，主进程只验证 URL 位于官方 `/trade2` 路径。现有行为存在以下缺口：

- 官方首页、登录页或其他非搜索页也可能被保存。
- 没有提取并持久化 leagueId 和 searchCode，监控启动时只能再次临时解析 URL。
- 没有保存搜索请求 JSON，searchCode 失效后无法重新生成相同搜索。
- 同一搜索可以重复收藏，没有 canonical key 或 query hash。
- 更新操作只能改名称、备注和目录，不能把收藏替换为新的当前搜索条件。
- 没有 valid/needs-refresh/invalid 状态和最近验证时间。
- 删除、更新、realm 切换没有与 Live 连接生命周期协调。
- 卡片没有搜索条件摘要、赛季、监控目标状态和错误恢复入口。

因此不能直接在现有 `url` 字段上增加一个监控按钮就进入实施。

### 4.2 搜索收藏模型

```ts
type SavedSearchCaptureSource = 'official-page' | 'superpoe-query' | 'code-only'

interface SavedMarketSearch {
  id: string
  realm: 'cn' | 'global'
  leagueId: string
  searchCode: string
  canonicalUrl: string
  name: string
  note?: string
  folderId?: string
  sortOrder: number
  querySnapshot?: {
    source: Exclude<SavedSearchCaptureSource, 'code-only'>
    body: unknown
    hash: string
    capturedAt: string
  }
  createdAt: string
  updatedAt: string
}

interface PurchaseTarget {
  id: string
  sourceSearchId?: string
  sourceSearchUpdatedAt?: string
  name: string
  status: 'armed' | 'paused' | 'completed'
  priority: 'high' | 'normal' | 'low'
  search: MarketSearchReference // 创建时的独立快照
  createdAt: string
  updatedAt: string
  statusChangedAt: string
}
```

运行时另行计算：

```ts
type SavedSearchValidity = 'unknown' | 'valid' | 'needs-refresh' | 'invalid'

interface SavedSearchRuntimeState {
  searchId: string
  validity: SavedSearchValidity
  checkedAt?: string
  errorCode?: 'invalid-url' | 'expired-code' | 'auth-required' | 'league-unavailable'
}
```

`realm + leagueId + searchCode` 是当前官方引用，不是永久业务主键。购买目标持有创建时的搜索引用快照；保存搜索后续更新时只提示源已变化，由用户确认后才能替换目标条件并重连。

### 4.3 独立界面与生命周期

- `保存的搜索` 位于装备仓库，只负责目录、复用、更新和创建购买目标。
- `实时监控` 独立管理目标状态、优先级、连接和提示设置。
- `机会中心` 独立保存 Live 批次和装备详情；机会引用 `targetId + batchId`。
- 全局最多同时启用 5 个购买目标；暂停和已完成目标不占用连接名额。
- 同一保存搜索默认只允许一个未完成目标；完成后可新建下一目标。
- 删除目标不删除保存搜索；删除保存搜索不删除目标及机会历史。
- 旧版本挂在 `SavedMarketSearch` 上的监控状态首次读取时迁移为独立目标。

### 4.4 当前搜索识别

只有通过严格解析的官方结果页才能启用“保存当前搜索”：

```text
https://{official-host}/trade2/search/poe2/{leagueId}/{searchCode}
```

- host 必须匹配当前 realm。
- leagueId 和 searchCode 必须通过长度与字符校验。
- 登录页、首页、错误页和只有 league、没有 searchCode 的页面不能保存。
- URL 必须 canonicalize，移除无关 query/fragment，不能保存认证跳转参数。
- 保存按钮的 enabled 状态由主进程解析结果驱动，不能仅判断 `currentUrl` 非空。

### 4.4 查询快照来源

搜索收藏分为三种能力等级：

1. `superpoe-query`：由仓库找相似、查价器或 SuperPoE2 查询构建器创建。请求 JSON 已知，必须保存经过 validator 清理的 query snapshot。
2. `official-page`：用户在内嵌官方网页创建搜索。主进程可只读观察该 realm session 中精确匹配 `/api/trade2/search/poe2/{league}` 的 POST body，并与随后同 webContents、同 league 的搜索 URL 变化做短时关联。
3. `code-only`：无法安全、唯一关联请求体时只保存 searchCode，不能猜测 query snapshot。

官方页面捕获约束：

- 不覆盖或修改页面 `fetch`、XHR、WebSocket 和请求结果。
- 只观察严格 allowlist 的 Trade2 Search POST，不读取登录、私聊或其他请求体。
- 请求体限制大小并经过共享 TradeSearch validator，剥离未知字段后才允许持久化。
- 快速连续搜索导致关联不唯一时降级 `code-only`，不能把错误 query 绑定到收藏。
- Cookie、Header、认证参数和响应原文不得进入搜索收藏。

是否能通过 Electron `session.webRequest` 在当前 Electron 版本稳定取得 POST upload body，必须在 O0 技术验证中确认；不能在验证前承诺所有官方网页搜索都有 snapshot。

### 4.5 保存交互

“保存当前搜索”使用项目内表单或小型 modal，不再使用 `window.prompt()`：

- 搜索名称，必填并提供合理默认值。
- 目录，默认当前搜索目录。
- 备注，可选。
- “同时开始监控”开关，默认关闭。
- 开启监控时显示 high/normal/low 优先级，默认 normal。
- 搜索条件摘要、realm 和 league 只读展示。

保存前按以下顺序处理重复：

1. 相同 `realm + leagueId + searchCode`：提示已收藏并定位已有记录，不创建重复项。
2. query hash 相同但 searchCode 不同：更新已有收藏的官方引用和验证时间，保留原 ID、目录和历史。
3. code-only 且无法证明相同：允许另存，但显示搜索条件无法恢复的能力状态。

### 4.6 打开、更新与恢复

- 打开收藏：切换到 search.realm 并加载 canonicalUrl。
- “用当前搜索更新”：当前页面必须是同 realm 的有效搜索；替换 leagueId、searchCode、canonicalUrl 和可用 query snapshot，保留本地 ID、目录、名称、备注和历史。
- armed 目标更新搜索条件：先关闭旧 WebSocket，原子保存新引用，通过校验后再连接；失败时保留旧记录并恢复旧连接。
- searchCode 失效且有 query snapshot：通过对应 realm session 重新 POST query，取得新 searchCode 后原子更新并重连。
- searchCode 失效且为 code-only：标记 `needs-refresh`，引导用户打开官方搜索、重新执行条件并使用“用当前搜索更新”。
- league 不再可用：标记 invalid，暂停监控；不能静默切换到新赛季。

### 4.7 目录、排序与删除

- 搜索收藏继续复用现有 searches 目录树，支持新建、重命名、删除、嵌套、拖拽移动和目录排序。
- 搜索卡片支持拖拽移动，并增加稳定 `sortOrder`；不能依赖数组写入顺序。
- 删除 armed 目标前明确显示会停止监控；确认后先关闭对应 WebSocket，再删除收藏。
- 删除 paused/completed 搜索不自动删除机会历史；历史显示“来源搜索已删除”。
- 删除目录沿用统一目录迁移规则，不能静默级联删除其中搜索和活动目标。

### 4.8 搜索卡片

卡片至少显示：

- 名称、备注、realm、league 和查询能力（可恢复/code-only）。
- saved/armed/paused/completed 购买目标状态。
- valid/needs-refresh/invalid 搜索状态。
- 连接中、监控中、重连中或需要登录。
- 优先级、最近机会时间和待处理数量。
- 打开、开始监控、暂停、恢复、完成、用当前搜索更新、移动、编辑和删除。

卡片不能在 WebSocket open 之前显示“监控中”，也不能把 code-only 描述为可自动恢复。

## 5. 用户流程

### 5.1 建立购买目标

1. 用户在官方集市完成搜索。
2. 在“装备仓库 -> 搜索收藏”保存当前搜索。
3. 用户选择目标优先级并点击“开始监控”。
4. 主进程校验 realm、league 和 search code，并建立对应 Live 连接。
5. 连接成功后显示“监控中”；未登录时保留目标并显示“需要登录”。

### 5.2 发现机会

```text
Official Live result
        |
        v
validate + coalesce + deduplicate
        |
        v
bounded batch Fetch + availability validation
        |
        v
rank opportunities across monitor tasks
        |
        +-> persist short-lived opportunity records
        |
        `-> game window foreground?
              |- no  -> update SuperPoE2 only
              `- yes -> show opportunity panel + one sound
```

### 5.3 用户决策

| 动作 | 语义 | 目标是否继续 |
| --- | --- | --- |
| 尝试前往 | 重新校验并发送一次藏身处请求 | 默认继续 |
| 下一个 | 当前机会暂不处理，切换候选 | 继续 |
| 跳过这件 | 当前 listing 不合适 | 继续 |
| 返回游戏 | 收起本轮机会面板 | 继续 |
| 暂停监控 | 暂时不需要后续机会 | 停止，可恢复 |
| 完成目标 | 已买到或不再需要 | 停止，可重新激活/复制 |

不使用含义模糊的“忽略”作为领域动作。

## 6. 领域模型

### 6.1 购买目标

```ts
type MonitorTaskStatus = 'saved' | 'armed' | 'paused' | 'completed'
type MonitorTaskPriority = 'high' | 'normal' | 'low'
```

字段归属以 4.2 的 `SavedMarketSearch` 为准。`alerting` 和 `acting` 是运行时状态，不写入搜索收藏。迁移时，既有搜索补齐 `saved + normal + sortOrder`，不能在升级后自动连接。

### 6.2 连接状态

```ts
type MonitorConnectionStatus =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'auth-required'
  | 'invalid-search'
  | 'error'

interface MonitorRuntimeState {
  searchId: string
  connectionStatus: MonitorConnectionStatus
  connectedAt?: string
  retryAttempt: number
  nextRetryAt?: string
  lastErrorCode?: string
  lastOpportunityAt?: string
  pendingOpportunityCount: number
}
```

用户目标状态与网络连接状态必须分开。例如目标可以是 `armed`，但当前连接为 `auth-required`。

### 6.3 机会状态

```ts
type OpportunityStatus =
  | 'detected'
  | 'fetching'
  | 'actionable'
  | 'attempting'
  | 'attempted'
  | 'skipped'
  | 'unavailable'
  | 'expired'
  | 'error'

interface MarketOpportunity {
  id: string
  searchId: string
  realm: 'cn' | 'global'
  leagueId: string
  searchCode: string
  listingId: string
  status: OpportunityStatus
  detectedAt: string
  fetchedAt?: string
  attemptedAt?: string
  item?: {
    name: string
    baseType: string
    rarity?: string
    iconUrl?: string
    price?: string
  }
}
```

同一 listing 同时命中多条搜索时，持久化层保留多条目标关系；机会面板可合并成一张候选卡并显示“匹配 N 个目标”，避免重复占据注意力。

## 7. 官方 Live 连接

### 7.1 地址与校验

```text
wss://poe.game.qq.com/api/trade2/live/poe2/{league}/{searchCode}
wss://www.pathofexile.com/api/trade2/live/poe2/{league}/{searchCode}
```

地址只能由主进程从已保存并校验的官方搜索 URL 派生：

- scheme 必须为 `https:`，host 必须与 search.realm 匹配。
- 路径必须匹配 `/trade2/search/poe2/{league}/{searchCode}`。
- search code 仅允许安全字符且限制长度。
- league decode 后限制长度并拒绝路径/查询分隔符。
- Live realm 固定为 `poe2`，renderer 不能覆盖 host、realm 或 URL。

### 7.2 会话复用

WebSocket 在官方集市 `WebContents` 的隔离 market preload 中建立，复用对应 realm 的 persistent partition、Cookie、代理和证书策略。连接不进入官方页面主世界，不覆盖页面自己的 WebSocket。

主进程 `MarketMonitoringCoordinator` 保存目标意图和运行状态。页面 reload/navigation 销毁 preload 后，新的 preload ready 触发全量 resync。启用目标的 realm view 即使未挂载到主窗口，也要保持 detached `WebContentsView` 与官方 host 会话。

### 7.3 重连

非用户主动停止时采用带抖动指数退避：`1s, 2s, 5s, 10s, 30s, 60s`。稳定连接后清零失败次数。

- 暂停、完成或删除目标：主动关闭，不重连。
- URL 无效：`invalid-search`，不无限重试。
- 会话无效：`auth-required`，等待登录状态变化。
- 睡眠、离线和网络恢复：Coordinator 统一 resync，不能创建并行重复连接。

## 8. 突发机会处理

### 8.1 事件合并

Live result 可能在极短时间返回大量 listing。Opportunity Engine 使用约 `250ms` 的技术合并区间，将相邻消息合并成一个 ingest burst：

- 每个 listing ID 先做格式校验和去重。
- 一个 burst 无论包含多少 listing，最多触发一次声音和一次面板显现。
- 合并区间只减少网络/UI 抖动，不改变暂停或完成目标的语义。

### 8.2 有限 Fetch

- 使用官方 Fetch 支持的批量上限分批请求，真实上限在国服/国际服 smoke test 中固化。
- 优先补全机会面板能够展示的候选，不等待全部结果。
- 每个 realm 使用有界并发并遵守官方 rate-limit headers。
- 超出首批预算的 listing 先保存最小记录，按排序需要或打开主界面时再补全。
- Fetch 无结果时标记 `unavailable`，不能继续显示为可操作。

### 8.3 去重

网络去重键为 `realm + searchCode + listingId`，建议保留 24 小时、有界 5,000 个键。WebSocket 重连重复推送不得重复响铃、增加机会数或弹出面板。

显示层以 `realm + listingId` 合并同一装备的多目标命中，但不能丢失目标关系。

## 9. 机会排序与公平性

Opportunity Engine 只排序，不声称能够预测成交成功率。

排序顺序：

1. 购买目标优先级：high > normal > low。
2. 已完成基础校验并取得 listing 详情的机会优先。
3. detectedAt 越新越优先。
4. 当前可见候选中为不同目标保留公平位置，避免单一爆发目标占满面板。
5. 同目标同批结果保持稳定顺序，Fetch 补全不能导致列表反复跳动。

第一版不跨通货自动计算“最便宜”或“最划算”。用户应在官方搜索中表达价格约束；未来引入价格评分必须有可追溯汇率、时间戳和关闭开关。

## 10. 新鲜度与有效性

机会面板显示相对时间和状态，不根据时间直接断言成交：

| 年龄/结果 | 展示 |
| --- | --- |
| 0-5 秒 | 刚刚发现 |
| 5-15 秒 | 新挂单 |
| 15 秒以上 | 可能已被抢先 |
| Fetch 无结果 | 已失效 |
| hideout 请求已发送 | 已尝试，不代表购买成功 |

机会超过短期操作时限后从游戏面板移出并进入历史。第一版建议以 2 分钟作为面板默认上限，真实值通过实机观察调整；`actionable` 状态仍以重新 Fetch 为准。

## 11. 游戏窗口识别

订阅监控与查价器共用 Windows `GameWindowService`，不使用 `tasklist`、PowerShell 或独立轮询实现。

```ts
type GameRuntimeState =
  | { status: 'unknown'; checkedAt?: string }
  | { status: 'stopped'; checkedAt: string }
  | {
      status: 'background' | 'foreground'
      checkedAt: string
      clientRealm: 'cn' | 'global' | 'unknown'
      processName: string
      pid: number
      bounds?: Rectangle
      elevated?: boolean
    }
```

Windows 原生适配器：

1. `EnumWindows` + `GetClassNameW` 筛选 `POEWindowClass`。
2. `GetWindowThreadProcessId` 取得 PID，受限读取进程名和路径。
3. `GetForegroundWindow` 区分前台/后台。
4. `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` 读取边界，失败回退 `GetWindowRect`。
5. 用发行渠道和已验证路径区分 PoE2、国服 WeGame 与国际服 GGG/Steam；窗口标题只作辅助证据。

国服和国际服预计共用 `POEWindowClass`。国服可能使用本地化标题和 WeGame `rail_apps`/应用 ID `2002052`，国际服通常为 `Path of Exile 2` 与 GGG/Steam 路径。两端必须采集真实 fixture 后固化。

`clientRealm` 不自动修改应用 `defaultRealm`。客户端与机会 realm 明确不一致时禁用藏身处操作；无法识别时允许展示，但保留官方失败提示。HWND 不发送给 renderer。

## 12. SuperPoE2 主界面

主界面是购买目标、提醒设置和历史的唯一完整管理入口。

### 12.1 全局状态

集市工具栏显示：

```text
游戏 ●前台 | 监控 3/5 | 待处理 8 | 游戏提醒 已开启
```

统一菜单管理：

- 启用/暂停全部监控连接。
- 游戏机会面板开关。
- 提示音、音量、试听和勿扰。
- 打开购买目标管理。
- 查看近期机会历史。

### 12.2 购买目标管理

位于“装备仓库 -> 搜索收藏”：

- saved/armed/paused/completed 状态。
- high/normal/low 优先级。
- 连接中、监控中、重连中、需要登录和错误。
- 最近机会时间、待处理数。
- 开始、暂停、恢复、完成、打开搜索、移动、编辑和删除。

暂停/完成不删除搜索或历史。重新启用必须由用户主动操作。

## 13. 游戏内机会面板

### 13.1 窗口形态

使用单一、固定尺寸、无系统通知的 Electron `BrowserWindow`：

```ts
{
  width: 420,
  height: 304,
  frame: false,
  transparent: true,
  resizable: false,
  minimizable: false,
  maximizable: false,
  skipTaskbar: true,
  show: false,
  alwaysOnTop: true
}
```

默认距游戏所在显示器右上角 18 DIP，支持四角设置。使用 `showInactive()` 避免抢焦点；点击操作时才获得交互焦点。窗口化和无边框全屏受支持，独占全屏不保证覆盖。

视觉沿用集市仓库：近黑背景、克制金色边框、4px 圆角、官方稀有度颜色和固定布局，不使用模糊、弹跳、大幅缩放或持续闪烁。

### 13.2 信息结构

```text
高生命高抗性项链
刚发现 18 件 · 当前可尝试 3 件       [返回游戏]

重点机会
稀有项链                         5 崇高石
刚刚 · 已取得 listing 信息
[尝试前往]

其他机会
8 崇高石 · 2 秒前          10 崇高石 · 4 秒前

[下一个] [跳过这件] [暂停监控] [SuperPoE2]
```

- 一次突出一个重点机会，最多显示两个紧凑备选。
- 其他目标命中只显示数量 badge，不把几十件装备混成滚动历史。
- 当前重点失效时自动晋升下一个候选，但不自动发送请求。
- “返回游戏”只收起当前 alert session，不暂停目标。
- “暂停监控”只暂停当前重点机会所属目标。
- 成功发送藏身处请求后提供“完成目标”和“继续等待”，不能自动判断用户已买到。

### 13.3 Alert session

首次出现经过基础校验的机会时创建 alert session。同一轮连续 listing 更新当前面板，不重复显现和响铃。连续 10 秒没有新 listing 或所有候选均已处理/失效时结束本轮；真实 quiet gap 在 smoke test 中调整。

用户点击“返回游戏”后，本轮不再自动打开；机会继续记录到 SuperPoE2。新一轮独立 alert session 可以再次提示。暂停或完成目标则不再建立该目标的新 session。

## 14. 尝试前往藏身处

点击“尝试前往”后必须重新验证：

1. 使用机会绑定的 realm、listingId 和 searchCode 重新 Fetch。
2. Fetch 无结果：标记 `unavailable`，显示“可能已被其他玩家抢先”，晋升下一候选。
3. 取得最新 hideout token 后调用现有 `MarketViewManager.visitHideout()`。
4. 成功只标记 `attempted` 并显示“已发送藏身处请求”。
5. 游戏未在线使用现有友好提示；网络失败允许用户重试。

操作期间仅禁用当前机会的重复点击。不能自动尝试下一个 listing，不能从 renderer 接受任意 token、realm、searchCode 或 listingId。

## 15. 提示音

声音使用应用内置本地资源：

- 只有首个候选完成基础校验、进入可尝试状态且游戏位于前台时播放。
- 同一 alert session 和同一 ingest burst 只播放一次。
- 原始 Live 消息、历史恢复、后台游戏、Fetch 全部失效时不播放。
- 勿扰或游戏机会面板关闭时不播放。
- 音量默认 70%，支持关闭和试听。
- 播放失败不影响机会记录和连接。

## 16. 历史与存储

机会历史使用独立原子文件，例如：

```text
app.userData/market/opportunities.v1.json
```

默认保留最近 30 条或 24 小时，以先达到者为准。保留目标、listing、检测/校验/尝试时间和安全装备摘要；不保存 Cookie、私聊、账号名、完整 Live payload 或完整 Fetch response。

机会不会自动进入装备仓库。用户显式收藏时，继续以 `market-favorite` 来源进入统一 `EquipmentLibraryRepository`。

## 17. IPC 与安全

主窗口 bridge 提供目标 CRUD、运行状态、机会查询、设置和订阅事件。market preload 内部 channel 只允许 ready、下发已校验配置、回传连接状态和大小受限的 Live result。

机会面板使用独立 preload，只能：

- 读取主进程选择的当前机会 DTO。
- 下一个、跳过、返回游戏。
- 暂停/完成当前机会绑定的目标。
- 对当前机会发起一次重新验证后的藏身处请求。
- 打开 SuperPoE2 目标/历史入口。

所有 IPC 校验专属 sender webContents。窗口不能提交任意 URL、搜索 ID、listing 引用、token 或脚本。

## 18. 错误与降级

| 场景 | 行为 |
| --- | --- |
| Session 未登录/过期 | 目标保留 armed，连接显示需要登录，登录后恢复 |
| 搜索失效 | 标记 invalid-search，不无限重连 |
| 网络断开 | 指数退避，显示下次重试，不创建并行连接 |
| Live 突发过大 | 有界合并、有限 Fetch，超出部分保存最小记录 |
| Fetch 限流 | 遵守响应头，优先重点候选，不绕过限制 |
| listing 已失效 | 从游戏面板移除，历史标记 unavailable |
| 游戏检测失败 | 只更新 SuperPoE2，不显示机会面板 |
| 客户端 realm 不一致 | 禁用藏身处，保留打开官方搜索 |
| 游戏未登录角色 | 显示友好错误，不把 attempted 当成功 |
| 面板/声音失败 | 机会历史和连接继续工作 |

## 19. 测试与验收

### 19.1 单元测试

- 严格搜索 URL parser：双区服 host、leagueId、searchCode、编码、重定向参数和非搜索页拒绝案例。
- canonical URL 生成、同 searchCode 去重、同 query hash 更新引用和 code-only 不误合并。
- 查询快照 validator、稳定 hash、大小限制、未知字段剥离和敏感字段不落盘。
- `superpoe-query`、`official-page`、关联歧义降级 `code-only` 的判定。
- searchCode 失效后由 query snapshot 重新 Search、原子替换引用和失败回滚。
- armed 搜索更新时旧连接停止、新记录落盘、新连接启动的顺序；任一步失败恢复旧记录与旧连接。
- 搜索目录新建、重命名、删除迁移、嵌套、目录排序和卡片拖拽排序。
- 双区服搜索 URL 到 Live URL 的解析和拒绝案例。
- 目标 saved/armed/paused/completed 迁移与转换。
- 连接状态、退避、登录恢复和主动停止不重连。
- 250ms burst 合并、消息大小限制和跨重连去重。
- Fetch 预算、限流、公平排序、稳定顺序和多目标同 listing 合并。
- 机会状态 detected 到 attempted/unavailable/expired 的转换。
- alert session 只响一次、返回游戏不重复打开本轮、暂停/完成不再提示。
- 重新 Fetch 后才允许藏身处，renderer 不能替换 listing 引用。
- 历史原子保存、裁剪和损坏恢复。

### 19.2 Electron/原生测试

- `session.webRequest` 仅观察精确 allowlist 的 Search POST；不同 webContents、league 或时间窗的请求不能误关联。
- 保存按钮只对主进程确认的有效当前搜索启用，页面跳转后及时失效。
- 保存、重复定位、用当前搜索更新、删除 armed 搜索和 code-only 恢复引导的 IPC 闭环。
- detached realm view 保持连接，reload 后 resync。
- 国服/国际服 partition 隔离。
- `POEWindowClass`、前后台、边界、realm 分类和高完整性诊断。
- 主窗口、market preload 和机会面板 IPC sender 隔离。
- 面板不抢焦点，多显示器/DPI 正确，退出无残留窗口和连接。

### 19.3 实机验收

- 国服和国际服各保存一条官方搜索；首页、登录页、错误页和缺少 searchCode 的 URL 不能收藏。
- 同一搜索重复收藏不会生成重复卡片；修改条件后可更新原收藏且目录、名称和历史不丢失。
- SuperPoE2 生成的搜索可自动恢复失效 searchCode；无法捕获查询体的官方搜索明确显示 code-only，并可人工刷新。
- 搜索目录和卡片可以维护、排序、移动；删除活动搜索会先确认并停止其连接。
- 国服和国际服各启用真实购买目标并收到 Live result。
- 单条、瞬间大量、持续爆发和多个目标同时命中。
- 从 Live 到首个可尝试候选的延迟。
- 重复 listing 不重复提示，失效 listing 快速淘汰。
- 点击尝试后成功、已被抢、游戏离线和网络错误。
- 返回游戏、跳过、暂停、完成和重新启用。
- 游戏后台只记录，前台显示；区服不一致禁用藏身处。
- 窗口化、无边框全屏、1024x720、1440x960、高 DPI 和双显示器。

## 20. 实施阶段

### Phase O0：搜索收藏可用化（已实现）

- 实现严格的双区服搜索页 parser、canonical URL、leagueId/searchCode 持久化和数据库迁移。
- 用项目内 modal 替代 `window.prompt()`，补齐搜索摘要、目录、重复检测、排序、编辑和删除交互。
- 为 SuperPoE2 查询保存 validated query snapshot；验证并接入官方 Search POST body 的安全观察，无法可靠关联时降级为 code-only。
- 实现 valid/needs-refresh/invalid 状态、“用当前搜索更新”和 query snapshot 重新生成 searchCode。
- 将搜索更新/删除与监控连接做原子协调，旧数据迁移后默认 saved，不自动开始监控。

完成标准：双区服只能收藏有效搜索结果页，重复收藏、条件更新、目录维护和跨重启均稳定；搜索码失效时可自动恢复或给出明确人工恢复入口，且没有 Cookie/Header/认证数据进入收藏文件。

### Phase O1：真实 Live 与领域基础（已实现，待双区服登录 smoke test）

- 固化双区服 Live URL、消息格式、Cookie/Origin 和连接限制。
- 购买目标 schema、连接 Coordinator、preload resync、退避和去重。
- 真实国服/国际服 session smoke test。

完成标准：至少一个 realm 可以稳定监控 O0 产生的真实保存搜索，reload/restart 后按目标状态正确恢复且不重复记录。

### Phase O2：Opportunity Engine（已实现）

- ingest burst、有限 Fetch、状态机、排序、公平性和短期历史。
- 多目标同 listing 合并、过期和 unavailable 处理。
- 主界面目标管理与机会历史。

完成标准：大量瞬时命中不会造成请求/声音/窗口洪泛，首批重点候选优先可见。

### Phase O3：游戏窗口与机会面板（已实现）

- 与查价器共用 `GameWindowService`。
- 固定机会面板、alert session、提示音和主界面设置。
- 尝试前往、重新验证、暂停和完成目标。

完成标准：游戏前台时用户能低干扰地判断并主动尝试；返回游戏、暂停和完成的语义稳定且不会误操作其他目标。

### Phase O4：稳定性与发布（代码完成，待实机验收）

- 双 realm、断网、限流、登录过期、睡眠恢复和长时运行。
- Windows 打包、DPI、多显示器和无边框全屏。
- 日志脱敏、资源上限和 IPC 安全回归。

完成标准：无重复连接、无限历史、提示洪泛或残留窗口；产品文案不承诺无法证明的购买结果。
