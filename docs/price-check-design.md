# SuperPoE2 统一交易、装备仓库与国服/国际服查价详细设计

> 状态：PriceCheck 独立模块设计已定稿；共享 M0 交易基础可复用；M6 游戏内查价待开发
> 更新日期：2026-08-01
> 适用项目：`D:\sources\superpoe`
> 目标平台：Electron 桌面端，支持 Windows 与 macOS Apple Silicon
> 关联路线图：`docs/ROADMAP.md` 中 M0“集市、统一装备仓库与共享交易基础”和 M6“游戏内查价器与构筑提升浮层”
> 配套设计：[marketplace-browser-design.md](./marketplace-browser-design.md)

## 1. 文档目的

本文定义 SuperPoE2 统一交易领域和游戏内查价功能的产品边界、系统架构、数据模型、解析流程、国服与国际服适配、Electron IPC、安全策略、缓存、错误处理、测试和分阶段交付方案。内嵌集市、页面收藏、PoB 导入、装备界面收藏和游戏内查价共用会话、官方数据、Stat resolver、查询构建、listing validator 与装备仓库。

本设计仅覆盖“复制游戏物品并查询官方交易市场挂单”。把市场候选装备代入当前构筑、计算 DPS/防御提升和购买收益排序属于后续能力，不进入第一阶段实现。

## 2. 已确认决策

以下事项已确认，不再作为实现选项：

1. 国服与国际服在同一版本内实现，使用统一领域模型和分区服适配器。
2. 不依赖 Xiletrade 的代码、模型或数据文件。
3. 不使用 PoB `TradeSiteStats.lua` 作为交易 Stat 数据兜底。
4. Stat 数据唯一事实来源是对应区服官方 `/data/stats` 接口。
5. `/data/stats` 响应允许保存到用户目录作为运行时缓存，但不提交到仓库，不作为人工维护的数据源。
6. 国服搜索、Stats、赛季和 Fetch 必须全部走国服接口；国际服同理，禁止跨区服拼接数据。
7. PoB Lua 继续负责构筑和计算语义，不承担中文游戏剪贴板解析职责。
8. 查价器不维护独立区服选项；国服或国际服统一由项目全局设置 `AppSettings.defaultRealm` 决定。
9. 名称/基底和结构化过滤器同样只使用对应区服官方 `/data/items`、`/data/filters`；现有英文 PoB 基底数据不作为国服交易名称来源。
10. 仓库装备是持久化主体；市场收藏、PoB 导入、装备界面收藏、手工录入和查价记录是可并存的来源，不建立独立收藏表。
11. 仓库和查价器共用唯一 `TradeStatResolver`。Stat ID 是带 realm、catalog hash 和解析证据的可重算快照，不是装备或词缀的永久主键。
12. 市场 listing 经官方 Fetch 取得可信数据后才能入库；DOM 注入只发送 `realm + queryId + listingId + sourceUrl`。
13. 现有构筑 `EquipmentItem` 与仓库 `LibraryItemSnapshot` 通过 Adapter 转换，上游 Trade DTO 不直接进入构筑模型。
14. PriceCheck 始终是独立业务模块和独立目录，不属于 Market。PriceCheck 只依赖共享的 `trade`、`library` 基础设施；Market 与 PriceCheck 禁止互相导入组件、状态、IPC 或业务协调器。

## 3. 产品目标与非目标

### 3.1 第一阶段目标

用户在 POE2 内把鼠标悬停到物品上并按全局热键后，应用应当：

1. 从游戏复制物品文本。
2. 根据当前区服和物品文本语言解析名称、基底、稀有度、核心面板属性和可搜索词缀。
3. 打开置顶查价窗口，允许用户选择词缀并调整 Min/Max。
4. 使用对应区服官方交易 API 搜索已标价挂单。
5. 展示价格、卖家状态、物品详情并支持分页。
6. 支持重新登录、刷新官方数据、重新搜索和查看可诊断错误。

### 3.2 非目标

第一阶段不实现：

- 自动代入当前 BD 计算装备提升。
- 自动购买、自动发送私聊或自动执行游戏操作。
- 声称某个单一数值是可靠的“真实价格”。
- 爬取第三方价格网站。
- 手工维护完整 Stat ID 表。
- 用模糊匹配结果静默提交可能错误的 Stat ID。
- 在浏览器版运行查价；该功能仅属于 Electron 桌面能力。

## 4. 用户流程

### 4.1 首次配置

1. 用户打开全局设置中的“查价器”。
2. 应用读取项目全局设置 `AppSettings.defaultRealm`，确定腾讯国服或国际服；查价器内不再提供第二套区服选择。
3. 应用从对应区服 `/data/leagues` 自动选择当前挑战赛季，不要求用户在全局设置里配置赛季。
4. 国服通过隔离的官方登录窗口建立 session；国际服匿名 Search 可用，不强制登录。
5. 启用全局热键，默认建议 `Ctrl+D`。
6. 应用注册热键并拉取该区服的官方 reference data。

国服与国际服 persistent session 必须隔离。用户修改项目全局区服设置后，查价器同步切换区服，但不得清理另一区服会话。

### 4.2 游戏内查价

1. 用户把鼠标悬停在物品上。
2. 用户按全局热键。
3. Electron 主进程确认当前窗口是 POE2；必要时按既定策略聚焦游戏窗口。
4. 主进程清理本次读取状态，向游戏发送 `Ctrl+C` 并读取系统剪贴板。
5. 主进程把原始文本交给 parser，并根据文本头部检测语言和可能区服。
6. parser 输出结构化 `ParsedTradeItem`。
7. renderer 在独立查价窗口显示物品和可搜索条件。
8. 用户勾选词缀、调整范围并点击搜索。
9. 主进程用官方 Stats catalog 将词缀解析为 Stat ID，生成查询并调用 Search API。
10. 主进程 Fetch 第一页详情，将脱敏后的结果返回 renderer。
11. 用户可翻页、返回修改条件、打开官方交易页或复制私聊文本。

### 4.3 再次触发热键

- 当前无查价窗口：创建并显示。
- 当前窗口显示旧物品：取消旧解析/搜索，替换为新物品。
- 当前正在搜索：旧请求标记为过期；新物品结果具有更高 generation，旧响应不得覆盖新状态。
- 剪贴板没有有效物品：保留窗口并展示明确错误，不显示上一次物品为本次结果。

## 5. 总体架构

```text
POE2 game
  | global hotkey + Ctrl+C
  v
Electron main process
  |- GameWindowService
  |- PriceCheckHotkeyService
  |- GameClipboardService
  |- TradeSessionManager
  |- TradeReferenceDataCache
  |- TradeApiClient (CN / Global adapters)
  |- TradeStatResolver
  |- OfficialTradeProvider (M0 / M6 shared application service)
  |- EquipmentLibraryRepository
  |- MarketViewManager + MarketEnhancementCoordinator
  |- PriceCheckCoordinator
  `- PriceOverlayWindowManager
          |
          | validated IPC, no raw session cookie
          v
Preload bridge
          |
          v
React price-check renderer
  |- item configuration view
  |- search state
  |- listing results
  `- login/settings status

Shared pure TypeScript domain
  |- item text parser
  |- shared TradeStatResolver
  |- query builder
  |- equipment library types/fingerprint/source ingestion
  `- runtime validators
```

### 5.1 进程职责

#### Electron 主进程

主进程拥有所有系统与敏感能力：

- 全局热键。
- 游戏窗口查找与输入模拟。
- 系统剪贴板。
- 登录窗口和按区服隔离的 persistent session。
- Cookie 明文只允许在主进程恢复会话的短生命周期内出现；日常请求由 Chromium CookieStore 自动附带，跨重启备份只允许使用按 realm 隔离的 `safeStorage` 密文。
- 官方交易 API 请求。
- 官方 reference-data 缓存文件。
- 置顶查价窗口生命周期。
- IPC 参数校验、限流、取消和错误脱敏。

#### Renderer

renderer 只负责：

- 展示解析后的物品。
- 编辑用户可控搜索条件。
- 展示请求状态、限流倒计时和结果。
- 发送经过类型约束的命令。

renderer 不应获得：

- POESESSID 原文。
- 缓存文件绝对路径。
- 任意 URL 请求能力。
- 任意文件读写能力。
- 任意窗口句柄或原生调用能力。

#### 纯 TypeScript 领域层

解析、规范化、Stat 匹配和查询构建应尽量保持为无 Electron 依赖的纯函数，以便 Vitest 覆盖。

### 5.2 与路线图 M0/M6 的共享边界

`TradeApiClient` 只负责 HTTP、session、限流和上游 DTO；内嵌集市、页面收藏、工作台查价（M0）与游戏内浮层（M6）共享 `TradeSessionManager`、`TradeStatResolver`、`EquipmentLibraryRepository` 和应用层 `TradeProvider`：

```ts
interface TradeProvider {
  getReferenceState(): Promise<TradeReferenceState>
  parseAndResolve(rawText: string): Promise<ResolvedTradeItem>
  resolveLibraryItem(item: LibraryItemSnapshot): Promise<ResolvedTradeItem>
  search(form: TradeSearchForm): Promise<TradeSearchResult>
  fetchPage(searchContextId: string, page: number): Promise<TradeListingView[]>
  fetchListing(ref: MarketDomListingRef): Promise<TradeListingView>
  ingestLibrarySource(input: LibrarySourceInput): Promise<EquipmentLibraryEntry>
  cancel(contextId?: string): void
}
```

第一版实现为主进程 `OfficialTradeProvider`，内部根据已同步的 `defaultRealm` 选择静态 profile。普通 renderer 方法不接受 realm 或 Base URL；来自隔离 market preload 的 listing 引用必须由主进程依据 sender webContents 与 partition 推导 realm。PriceCheckCoordinator 负责热键/generation/窗口，MarketEnhancementCoordinator 负责页面按钮与 listing 引用，两者都不能复制 Provider、resolver 或仓库逻辑。

这里的“共享”只表示依赖同一套无 UI 的交易基础设施，不表示模块合并。依赖方向固定为：

```text
Market --------> shared trade/library
PriceCheck ----> shared trade/library

Market -X-> PriceCheck
PriceCheck -X-> Market
```

`electron/main.ts` 只负责组合和生命周期，不承载 PriceCheck 业务实现。PriceCheck 的窗口、热键、剪贴板、parser、状态机、preload、IPC、UI、样式和测试必须全部收口到 `electron/priceCheck/` 与 `src/priceCheck/`。

### 5.3 统一装备仓库契约

所有装备来源进入同一个 `EquipmentLibraryRepository`：

```text
市场 listing 收藏 ----┐
PoB item 导入 --------┤
装备界面收藏 ---------+--> normalize --> fingerprint/upsert --> EquipmentLibraryEntry
游戏内剪贴板查价 ----┤                                      |
手工录入 -------------┘                                      `--> EquipmentItem Adapter / TradeSearchForm
```

仓库主体与来源必须分离：

```ts
interface EquipmentLibraryEntry {
  schemaVersion: 1
  id: string
  fingerprint: string
  item: LibraryItemSnapshot
  sources: EquipmentLibrarySource[]
  folderId?: string
  tags: string[]
  note?: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

type EquipmentLibrarySource =
  | MarketFavoriteSource
  | PobImportSource
  | EquipmentFavoriteSource
  | PriceCheckSource
  | ManualSource
```

`market-favorite` 以 `realm + listingId` 幂等，`pob-import` 以 `buildId + pobItemId` 幂等，`equipment-favorite` 以 `buildId + equipmentSetId + itemId` 幂等。取消某一来源只移除来源记录，不能在仍有其他来源、目录、标签或备注时删除仓库主体。PriceCheck 是否把每次解析自动入库由 UI 设置决定；用户显式“保存到仓库”必须写入 `price-check` 来源并保留原始剪贴板文本。

装备 fingerprint 只描述观察到的装备内容，不包含价格、卖家、realm、league、构筑 ID、listing ID 或 Trade Stat ID。跨语言或部分解析记录不得自动合并。详细来源、存储和页面注入边界见 [marketplace-browser-design.md](./marketplace-browser-design.md#11-统一装备仓库)。

## 6. 建议目录结构

```text
electron/
  trade/
    realmProfiles.ts
    sessionManager.ts
    referenceDataCache.ts
    apiClient.ts
    officialTradeProvider.ts
  library/
    equipmentLibraryRepository.ts
    equipmentLibraryValidator.ts
    sourceIngestion.ts
  priceCheck/
    coordinator.ts
    gameWindow.ts
    hotkey.ts
    clipboard.ts
    loginWindow.ts
    overlayWindow.ts
    preload.ts
    ipc.ts

src/
  trade/
    types.ts
    runtimeValidation.ts
    statTemplate.ts
    tradeStatResolver.ts
    tradeQueryBuilder.ts
    *.test.ts

  library/
    types.ts
    equipmentFingerprint.ts
    equipmentAdapter.ts
    *.test.ts

  priceCheck/
    PriceCheckApp.tsx
    domain/
      types.ts
      itemTextProfiles.ts
      itemTextParser.ts
      itemClassifier.ts
      priceSummary.ts
      *.test.ts
    state/
      priceCheckReducer.ts
      priceCheckViewModel.ts
      *.test.ts
    components/
      PriceCheckHeader.tsx
      PriceCheckFilters.tsx
      PriceCheckModifierRow.tsx
      PriceCheckResults.tsx
      PriceCheckListing.tsx
      PriceCheckLoginState.tsx
    __fixtures__/
    priceCheck.css
```

Electron 当前 `tsconfig.electron.json` 仅包含 `electron/*.ts`。如果采用子目录，需要把 include 扩展为 `electron/**/*.ts`。

共享领域模块会同时被 Vite 和 `tsc -p tsconfig.electron.json` 引用。`src/trade/` 与 `src/library/` 内供主进程使用的文件必须保持纯 TypeScript、使用相对导入且不得依赖 DOM、React、Zustand、`@/` 路径别名或 `src/priceCheck/`；当前 Electron `NodeNext` 配置不能解析 renderer 的 `@/` 别名。TypeScript 会像现有 `src/types/calc.ts` 一样把被 Electron 引用的共享文件输出到 `dist-electron/src/`。

PriceCheck 内部代码不得放入 `src/components/market/`、`electron/market*.ts` 或 Market store。即使某个组件当前只被一个页面使用，也必须先归属 `src/priceCheck/`；只有在出现真实的跨模块复用后，才能把无业务归属的纯能力下沉到共享目录。

## 7. 区服配置

### 7.1 统一配置模型

```ts
export type TradeRealm = 'cn' | 'global'

export interface TradeRealmProfile {
  realm: TradeRealm
  apiBaseUrl: string
  websiteBaseUrl: string
  searchPageBaseUrl: string
  origin: string
  referer: string
  defaultTextLanguage: TradeTextLanguage
}
```

建议配置：

| 字段 | 国服 | 国际服 |
| --- | --- | --- |
| API Base | `https://poe.game.qq.com/api/trade2` | `https://www.pathofexile.com/api/trade2` |
| Website | `https://poe.game.qq.com` | `https://www.pathofexile.com` |
| 默认文本语言 | `zh-CN` | `en` |
| Session partition | `persist:superpoe-trade-cn` | `persist:superpoe-trade-global` |
| 匿名 Search | 2026-07-29 实测返回 401 | 2026-07-29 实测可用 |

所有 URL 必须由静态 profile 生成，renderer 不允许传入 API Base URL。

### 7.2 区服判定

搜索区服唯一以项目全局设置 `AppSettings.defaultRealm` 为准，不能凭文本语言推断，也不能在查价窗口内覆盖。文本检测只用于解析器 profile 选择和警告。

当前 `AppSettings` 保存在 renderer 的 `localStorage`，主进程不能直接读取。启动时以及 `defaultRealm` 变化时，renderer 必须通过受校验的 IPC 将应用上下文同步给主进程。主进程保存当前 realm 快照，并在 copy、login、refresh、search 和 fetch 开始时统一解析对应 `TradeRealmProfile`。

区服变化时必须：

- 注销或取消旧区服正在执行的解析、限流等待、Search 和 Fetch。
- 切换到新区服的 league、reference-data cache 和认证状态。
- 保留两个区服各自的 persistent session 和缓存文件。
- 通知已打开的查价窗口刷新区服、赛季和登录状态。

当项目设置为国际服但复制到简体中文格式物品时：

- parser 可以尝试解析。
- 如果国际服 Stats catalog 不含对应本地化文本，则该词缀标记为 unresolved。
- 不允许自动改用国服 API。

## 8. 官方 API 设计

### 8.1 使用端点

每个区服使用相同相对端点：

```text
GET  /data/leagues
GET  /data/stats
GET  /data/items
GET  /data/filters
GET  /data/static
POST /search/{league}
GET  /fetch/{id1,id2,...}?query={searchId}
```

用途边界：

- `stats`：唯一 Stat ID、模板和 source 分组来源。
- `items`：对应区服的基底、传奇名称和物品类别 catalog；用于名称/基底验证，尤其是国服和魔法物品。
- `filters`：结构化过滤器的官方 key、选项和显示信息；query builder 不维护一份脱离官方接口的大型过滤器表。
- `static`：通货等静态显示信息；第一版可以只消费结果列表需要的子集。
- `leagues`：对应区服当前可搜索赛季列表。

2026-07-29 实测 CN 与 Global 上述五个 GET 端点均返回 `200 application/json`。现有 `public/data/item-bases.json` 只使用英文 PoB 基底名，不能替代国服 `/data/items`，也不是交易名称的权威来源。

登录流程使用对应交易站网页和 Cookie，不将第三方服务作为认证中介。

### 8.2 请求头

主进程统一添加：

- `User-Agent: SuperPoE2/{appVersion} (+{projectContactUrlOrEmail})`；发布构建必须包含真实可联系身份
- `Accept: application/json`
- `Content-Type: application/json`（POST）
- 对应区服的 `Origin`
- 对应区服的 `Referer`
- 对需要认证的请求使用对应 Electron session 自动附带 Cookie，不手工拼接 `Cookie` header

禁止记录完整 Cookie、Authorization、登录页面 URL 参数或包含敏感值的请求头。

### 8.3 超时与取消

建议默认值：

| 请求 | 超时 |
| --- | ---: |
| leagues/stats/items/filters/static | 15 秒 |
| search | 20 秒 |
| fetch | 20 秒 |

每次查价 session 持有 `AbortController`。新物品触发、窗口关闭、区服切换时取消旧请求。

### 8.4 限流

每个区服维护独立限流器：

- Search 与 Fetch 串行协调，但 reference-data 初始化不得阻塞依赖项已有有效缓存的查询。
- 读取官方 rate-limit headers 并更新本地窗口状态。
- 收到 `429` 时优先使用 `Retry-After`。
- 最多自动重试一次。
- 等待期间向 renderer 推送剩余秒数。
- 用户触发新物品时可以取消等待。

不应通过并发请求绕过官方限制。

### 8.5 API 错误分类

```ts
export type TradeErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'INVALID_QUERY'
  | 'NO_RESULTS'
  | 'UPSTREAM_CHANGED'
  | 'UNKNOWN'
```

主进程将上游响应映射为稳定错误码；renderer 根据错误码显示本地化文案，不直接显示完整响应体。

## 9. 官方参考数据下载与缓存

### 9.1 唯一数据来源

Stat catalog 只允许来自：

```text
CN     https://poe.game.qq.com/api/trade2/data/stats
Global https://www.pathofexile.com/api/trade2/data/stats
```

明确禁止：

- 读取 PoB `TradeSiteStats.lua` 作为运行时 fallback。
- 复制 Xiletrade `FiltersTwo.json`。
- 在源码中维护大规模 Stat ID 映射。
- 国服失败后改用国际服 Stats，反之亦然。

少量由官方语义无法表达的解析规则可以进入 parser，但不得用它们伪造 Stat catalog。

物品、结构化过滤器和静态数据同样只读取相同 realm profile 下的官方 `/data/items`、`/data/filters`、`/data/static`，不读取 Xiletrade 或其他第三方镜像作为 fallback。

### 9.2 缓存目录

建议存放：

```text
{app.userData}/trade-cache/
  cn/
    stats.json
    items.json
    filters.json
    static.json
    leagues.json
  global/
    stats.json
    items.json
    filters.json
    static.json
    leagues.json
```

缓存 envelope：

```ts
export interface TradeCacheEnvelope<T> {
  schemaVersion: 1
  realm: TradeRealm
  sourceUrl: string
  fetchedAt: string
  etag?: string
  lastModified?: string
  payloadHash: string
  payload: T
}
```

### 9.3 缓存策略

1. 缓存有效期默认 6 小时。
2. 有有效缓存时立即使用，并允许后台条件刷新。
3. 无缓存时必须等待本次解析/查询实际依赖的对应官方接口成功；Stat 搜索至少依赖 stats，名称校验至少依赖 items，结构化过滤器依赖 filters。
4. 刷新失败且已有可解析缓存时可继续使用该缓存，并显示“数据更新时间”。这属于官方响应缓存，不是替代数据源。
5. 缓存 JSON 损坏、realm 不符或 schema 不支持时隔离为 `.corrupt-{timestamp}`，重新下载。
6. 写缓存使用临时文件 + rename，避免崩溃留下半文件。
7. 可利用 `ETag`/`Last-Modified` 做条件请求；接口不支持时按 TTL 完整拉取。
8. 设置页提供“刷新交易数据”，不需要提供日常可见的“清空缓存”按钮；诊断页可提供清理入口。

### 9.4 内存索引

下载后构建：

```ts
interface TradeStatCatalog {
  realm: TradeRealm
  fetchedAt: string
  entries: TradeStatEntry[]
  byId: Map<string, TradeStatEntry[]>
  byNormalizedText: Map<string, TradeStatEntry[]>
  byTypeAndText: Map<string, TradeStatEntry[]>
}
```

同时建立：

```ts
interface TradeItemCatalog {
  realm: TradeRealm
  byType: Map<string, TradeItemEntry[]>
  byUniqueNameAndType: Map<string, TradeItemEntry>
}

interface TradeFilterCatalog {
  realm: TradeRealm
  groups: TradeFilterGroup[]
  byId: Map<string, TradeFilterEntry>
}
```

缓存文件保留官方原始 payload；规范化索引只在内存构建，避免缓存格式和匹配算法绑定。

### 9.5 Stat ID 的身份与持久化边界

2026-07-29 对两区服官方 `/data/stats` 的实测结果：

| 指标 | CN | Global |
| --- | ---: | ---: |
| entries | 7,530 | 8,236 |
| unique IDs | 7,454 | 8,156 |
| duplicate IDs | 76 | 80 |
| 两区服共有 unique IDs | 7,420 | 7,420 |
| realm only IDs | 34 | 736 |

`explicit.stat_3299347043` 当前在两区服分别对应 `# 生命上限` 与 `# to maximum Life`，说明官方 ID 具有较强跨语言稳定性；但集合不完全相同，且同一区服中一个 ID 可以对应多个显示模板。因此：

- catalog 索引必须是 `Map<string, TradeStatEntry[]>`，不能假设 ID 到模板是一对一。
- resolution 必须记录 realm、完整 `queryStatId`、命中的 catalog template、catalog payload hash 和解析方法。
- Stat ID 不参与装备 fingerprint，也不能作为跨 realm 的无条件永久语义 ID。
- 同 realm 再查询时先验证 ID 仍存在且 source/valueMode/option 兼容；失败则从原始文本重算。
- 跨 realm 相同 ID 只能作为强候选。目标 catalog 必须存在相同 source、兼容的值结构与固定选项；无法验证时进入 `ambiguous`，不得静默提交。
- 市场 Fetch 如果提供官方 Stat/hash 关系，记为 `resolvedBy='official-listing'`；PoB、装备面板和剪贴板文本仍通过共享 resolver 匹配。
- 旧扩展导出的静态 `trade2state.*.json` 不作为运行时 catalog 或 fallback；其条目数已经落后于当前官方响应。

## 10. 认证与会话

### 10.1 数据模型

```ts
interface TradeSessionState {
  realm: TradeRealm
  anonymousSearchSupported: boolean
  hasSession: boolean
  updatedAt?: string
  validationState: 'unknown' | 'valid' | 'expired'
}
```

IPC 只能返回上述状态，不能返回 Cookie 原文。

### 10.2 推荐登录流程

推荐以内嵌集市 `WebContentsView` 作为主要网页登录入口，并保留受限独立 `BrowserWindow` 作为认证流程 fallback。两者与 PriceCheck 使用同一个 realm 专属 persistent partition：

1. 通过 `session.fromPartition('persist:superpoe-trade-cn')` 或 global 对应 partition 取得 realm session。
2. 内嵌集市使用该 session 打开对应官方交易页面，用户在官方页面主动登录。
3. 认证子窗口设置 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`，不加载主窗口 preload，并限制导航/新窗口到 Phase 0 验证过的官方认证域名。
4. 只监听该 partition 是否出现符合域名与名称约束的 `POESESSID`；业务代码不复制、返回或记录 cookie value。
5. 后续交易请求统一使用该 realm 的 `session.fetch(..., { credentials: 'include' })`，让 Chromium CookieStore 自动附带 Cookie。
6. 用一次轻量官方请求验证；成功后关闭登录窗口。

国服和国际服使用不同 partition。2026-07-29 匿名实测结果是：国服 Search 返回 `401 Unauthorized`，国际服 Search 可返回 `200`。因此国服登录是搜索前置条件；国际服匿名模式应直接可用，登录入口只作为兼容更严格限流或未来策略变化的可选能力。

### 10.3 持久化与注销

- persistent partition 负责常规站点数据；由于官方 `POESESSID` 可能是会话 Cookie，主进程使用 Electron `safeStorage` 保存按 realm 隔离的加密快照，并在首次交易页面或 API 请求前恢复到同一 partition。
- 内嵌集市、认证子窗口和 `TradeApiClient` 必须由同一个 `TradeSessionManager` 创建或取得 session，禁止各自建立 partition。
- 注销只清理该 realm 专属 partition 的 cookie/storage，不影响主窗口 default session 或另一区服。
- 应用只把 `hasSession`、`validationState` 和时间戳传给 renderer。
- 不将 POESESSID 放进现有 renderer `localStorage`；加密文件只允许 Electron 主进程访问，renderer 和日志均不得取得原文。
- 日志中只允许记录 `hasSession=true/false` 和验证结果。
- 不提供手工 POESESSID 输入；`safeStorage` 密文仅能来自用户在受限官方登录页面中建立的会话。

### 10.4 手动输入

第一版不提供手动 POESESSID 输入。开发调试也优先使用隔离登录窗口，避免形成一条未经产品安全审查的凭据注入路径。

## 11. 游戏窗口、热键与剪贴板

### 11.1 热键

- 使用 Electron `globalShortcut` 注册。
- 默认建议 `Ctrl+D`，允许在设置中修改。
- 注册失败时展示“快捷键被占用”，不能静默失败。
- 应用退出、禁用查价器或设置变更时注销旧热键。
- macOS 若进入后续支持，需要单独验证权限；第一阶段系统输入实现以 Windows 为验收平台。

### 11.2 游戏窗口识别

Windows 优先按窗口类名 `POEWindowClass` 查找，并允许标题差异。应区分：

- 未发现游戏进程。
- 游戏存在但不是前台。
- 游戏以前台高完整性运行，而应用权限不足。

### 11.3 输入模拟

Electron 本身不提供可靠的系统级按键注入。实现前必须做独立技术验证，候选顺序：

1. 小型、边界明确的 Windows 原生模块调用 `SendInput`。
2. 已审计且可随 electron-builder 稳定打包的原生依赖。
3. 不采用启动 PowerShell 进程模拟按键的方案。

无论采用哪种方式，原生层只暴露“向已验证的 POE2 窗口发送复制组合键”，不暴露任意按键注入 IPC。

### 11.4 剪贴板协议

1. 记录当前剪贴板 sequence 或内容摘要。
2. 发送复制组合键。
3. 在最多 1 秒内轮询新文本。
4. 只有内容发生变化且通过物品头校验时才接受。
5. 失败时不得把旧剪贴板物品当成新结果。
6. 默认不恢复旧剪贴板；如产品要求恢复，必须避免覆盖用户在等待期间产生的新内容。

## 12. 物品文本解析

### 12.1 原则

解析器只提取交易搜索需要的信息，不复制 PoB 的完整计算语义，也不模拟 Xiletrade 的全部物品类型体系。

解析器输入是原始剪贴板文本，输出是：

```ts
export interface ParsedTradeItem {
  rawText: string
  language: TradeTextLanguage
  itemClass?: string
  rarity: TradeItemRarity
  name: string
  baseType: string
  itemLevel?: number
  quality?: number
  armour?: ParsedDefenceValue
  evasion?: ParsedDefenceValue
  energyShield?: ParsedDefenceValue
  spirit?: ParsedDefenceValue
  weapon?: ParsedWeaponProperties
  sockets?: string
  corrupted?: boolean
  identified?: boolean
  flags: TradeItemFlags
  flavourText: string[]
  cosmeticText: string[]
  modifiers: ParsedTradeModifier[]
  warnings: ParseWarning[]
}

export interface ParsedWeaponProperties {
  physicalDamage?: DamageRange
  elementalDamage: Array<DamageRange & {
    type: 'fire' | 'cold' | 'lightning' | 'chaos' | 'unknown'
  }>
  criticalStrikeChance?: number
  attacksPerSecond?: number
}

export interface DamageRange {
  min: number
  max: number
  augmented: boolean
}

export interface ParsedDefenceValue {
  value: number
  augmented: boolean
}
```

词缀模型：

```ts
export interface ParsedTradeModifier {
  id: string
  rawLines: string[]
  displayText: string
  normalizedText: string
  /** 用于选择 /data/stats 分组的最终来源。 */
  source: TradeStatSource
  /** 保留复制文本头部中的全部状态，不能因 source 归一化而丢失。 */
  sourceTags: TradeModifierSourceTag[]
  affixKind?: 'prefix' | 'suffix'
  valueMode: 'numeric' | 'presence' | 'fixed-option'
  /** 游戏文本数值到官方 Stats 模板数值的语义变换。 */
  valueTransform: 'identity' | 'negate'
  /** 按游戏文本展示的当前数值。 */
  currentValues: number[]
  /** 应用于官方交易过滤器的当前语义值。 */
  tradeValues: number[]
  tierRanges: Array<{ min: number; max: number }>
  selected: boolean
  min?: number
  max?: number
  resolution?: TradeStatResolutionSnapshot
}

export type TradeStatSource =
  | 'implicit'
  | 'explicit'
  | 'fractured'
  | 'crafted'
  | 'enchant'
  | 'rune'
  | 'desecrated'
  | 'unknown'

export type TradeModifierSourceTag =
  | 'implicit'
  | 'explicit'
  | 'fractured'
  | 'crafted'
  | 'enchant'
  | 'rune'
  | 'desecrated'
  | 'corrupted'
```

`resolution` 使用可持久化但可重新验证的快照：

```ts
export interface TradeStatResolutionSnapshot {
  realm: TradeRealm
  /** 提交 Search 时使用的完整 ID，固定选项后缀不能截断。 */
  queryStatId?: string
  baseStatId?: string
  optionId?: string
  candidateStatIds: string[]
  source: TradeStatSource
  catalogTemplate: string
  valueMode: 'numeric' | 'presence' | 'fixed-option'
  valueTransform: 'identity' | 'negate'
  resolvedBy: 'official-listing' | 'exact-text' | 'multi-line' | 'cross-realm-id' | 'user-confirmed'
  catalogFetchedAt: string
  catalogPayloadHash: string
  status: 'resolved' | 'ambiguous' | 'unresolved' | 'stale'
}
```

`ParsedTradeModifier.resolution` 与仓库 `LibraryModifier.tradeResolutions[]` 使用同一结构。parser 只产生原始证据和观察值，`TradeStatResolver` 负责 resolution；仓库、Market Fetch、装备面板和 PriceCheck 不得各自定义近似类型。

只有 `status='resolved'` 的 snapshot 必须且允许携带唯一 `queryStatId` 进入 Query Builder。`ambiguous` 只保存有限候选供用户确认，`unresolved` 可以没有候选；两者都不能提交搜索。

### 12.2 语言 profile

```ts
interface ItemTextProfile {
  language: TradeTextLanguage
  labels: {
    itemClass: RegExp
    rarity: RegExp
    itemLevel: RegExp
    quality: RegExp
    armour: RegExp
    evasion: RegExp
    energyShield: RegExp
    sockets: RegExp
    requirements: RegExp
  }
  markers: {
    unidentified: RegExp
    corrupted: RegExp
  }
  separator: RegExp
  modifierHeader: RegExp
}
```

首版 profile：

- `zh-CN`：腾讯国服简体文本。
- `en`：国际服英文文本。
- `zh-TW`：国际服繁体客户端文本。

语言检测根据头部字段完成。检测失败时依次尝试 profile，但只有满足强校验的结果才接受。

### 12.3 状态机

建议阶段：

```text
HEADER
  -> ITEM_IDENTITY
  -> PROPERTIES
  -> REQUIREMENTS
  -> SOCKETS_AND_RUNES
  -> MODIFIERS
  -> FLAVOUR_OR_FOOTER
  -> COSMETIC_OR_NOTE
```

`--------` 只表示区块边界，不直接决定区块语义；状态由下一行标签和上下文共同决定。

### 12.4 名称与基底

- 传奇物品通常有名称和基底两行。
- 稀有物品名称随机，搜索只能使用基底。
- 魔法物品名称可能包含前后缀，需要通过本地 base catalog 或官方可用数据识别基底。
- 普通物品通常名称即基底。
- 国服搜索使用国服接口接受的本地化名称/基底。
- 国际服搜索必须使用国际服接口可接受的名称/基底；英文客户端直接使用原文，繁体客户端需要通过稳定映射解决，不能仅做字符串翻译猜测。

国际服繁体基底映射是实现前必须验证的数据点。如果官方接口能返回带稳定 ID 的本地化 items 数据，应按 ID 合并；若不能，需要另立经过管线生成的名称映射设计，不能混入 Stats 缓存。

### 12.5 词缀区块

优先解析 `{...}` 头部确定来源类型，示例：

```text
{ 前缀属性 ... }
{ 后缀属性 ... }
{ 基底属性 ... }
{ 打造的 后缀属性 ... }
{ 亵渎的 前缀属性 ... }
{ 破碎的 打造的 后缀属性 ... }
```

一个头部可能同时包含多个状态，解析器必须全部保存到 `sourceTags`，再选择官方 Stats 分组所需的有效 `source`。已由真实样本确认：`破碎的 + 打造的` 表示一个原本属于 crafted 类、当前已破碎固定的词缀；查价使用 `fractured.*`，但仍保留 `crafted` tag 用于展示和诊断。不得简单按第一个或最后一个中文单词覆盖来源。

没有 `{...}` 头部不等于 `explicit`。符文词缀在国服真实复制文本中是一个独立区块，区块内每行没有词缀头；其来源由区块上下文推断为 `rune`。只有在区块边界、物品属性和 catalog 候选共同支持时才能做这种推断。

多行 Stat 必须合并为一个 modifier；不能把每一行都独立提交为 `and` 条件。合并规则由 Stats catalog 候选模板反向验证。

符文和装备固有技能默认不勾选，除非官方 Stats catalog 能明确解析且产品确认需要搜索。

### 12.6 国服真实样本：稀有邪恶节杖

首个验证 fixture 是物品等级 81 的稀有 `邪恶节杖`，随机名称为 `苍空 战具`。该样本的预期结构化结果如下：

| 字段 | 解析结果 | 查询用途 |
| --- | --- | --- |
| language | `zh-CN` | 选择简体 profile，不决定 realm |
| itemClass | `节杖` | 类型校验和 local/global 语义 |
| rarity | `rare` | 稀有物品只用 base type 搜索 |
| name | `苍空 战具` | 展示，不作为稀有物品查询 name |
| baseType | `邪恶节杖` | 查询 `type` |
| itemLevel | `81` | 默认展示；是否加入过滤器由用户选择 |
| quality | `20` | 面板属性，不当作词缀 |
| weapon.physicalDamage | `{ min: 66, max: 109, augmented: true }` | 展示/结构化武器过滤器 |
| weapon.elementalDamage | `fire 147-220`、`lightning 2-334` | 展示/结构化武器过滤器；不重复生成 Stat 条件 |
| weapon.criticalStrikeChance | `16.79` | 最终面板值，不等同于 `暴击几率 +4.79%` 词缀值 |
| weapon.attacksPerSecond | `1.75` | 最终面板值，不等同于 `攻击速度提高 25%` 词缀值 |
| sockets | `S S S` | 展示；不能把符文词缀并入 socket 文本 |
| warning | `你无法使用这项装备, 它的数值将被忽略` | 识别为客户端提示并忽略，不得破坏名称/基底定位 |
| footer flags | `分裂之物`、`引路石掉落` | 物品状态/来源标记，不是 modifier |

预期词缀解析和官方国服 Stats 匹配：

| 来源 | 当前文本与数值 | 有效 Stat ID | 默认选择 |
| --- | --- | --- | --- |
| rune | `技能速度提高 8%` -> `[8]` | `rune.stat_970213192` | 否 |
| rune | `对稀有或传奇敌人的攻击伤害提高 50%` -> `[50]` | `rune.stat_2077615515` | 否 |
| rune | `获得相当于伤害 5% 的所有元素额外伤害` -> `[5]` | `rune.stat_731403740` | 否 |
| explicit prefix | `攻击技能的元素伤害提高 136%` -> `[136]` | `explicit.stat_387439868` | 是 |
| explicit prefix | `附加 147 - 220 火焰伤害` -> `[147, 220]` | `explicit.stat_709508406` | 是 |
| desecrated prefix | `附加 2 - 334 闪电伤害` -> `[2, 334]` | `desecrated.stat_3336890334` | 是 |
| fractured + crafted suffix | `攻击速度提高 25%` -> `[25]` | `fractured.stat_210067635` | 是 |
| explicit suffix | `暴击几率 +4.79%` -> `[4.79]` | `explicit.stat_518292764` | 是 |
| crafted suffix | `所有攻击技能等级 +3` -> `[3]` | `crafted.stat_3035140377` | 是 |

该 fixture 固化以下规则：

1. 稀有度行与第一条分隔线之间允许出现客户端警告行。
2. `需求：` 的全角冒号和字段中的半角冒号都必须接受。
3. 面板的元素伤害一行可以包含多个带类型的区间；它是派生属性，不是独立 modifier。
4. tier 范围如 `(120-139)` 必须记录到 `tierRanges`，但模板匹配和当前值必须只使用范围外的 `136`。
5. 当前值允许带显式 `+`；catalog 模板没有 `+` 时仍可做可解释的精确匹配。
6. 武器上的局部攻击速度必须用物品类型补全官方模板中的 `(区域)`，匹配 `stat_210067635`；不能误选全局 `stat_681332047`。
7. 相邻 modifier header 本身就是上一词缀结束标志，不要求中间存在 `--------`。
8. `分裂之物` 和 `引路石掉落` 进入 footer/flags；它们及其后的内容不得退回 modifier 状态。
9. `(augmented)` 和 `(fire)`/`(lightning)` 是面板元数据；前者记录计算状态，后者用于拆分元素类型，二者都不是 tier 范围。
10. 面板最终值与生成它的词缀值分别存储，绝不能把 `16.79` 当成暴击词缀的筛选值，或把 `1.75` 当成攻击速度词缀的筛选值。

这里的“默认选择”只定义解析后的初始查价表单：符文默认展示但不勾选，其余已精确解析的主要词缀默认勾选。用户仍可在提交前修改。

### 12.7 国服真实样本：稀有劫掠者之帽

第二个验证 fixture 是物品等级 82 的稀有 `劫掠者之帽`，随机名称为 `鹰翼 慧眼`。预期核心字段为：

| 字段 | 解析结果 | 查询用途 |
| --- | --- | --- |
| itemClass | `头盔` | 类型校验和护甲 local/global 语义 |
| rarity | `rare` | 只用 base type 搜索 |
| name / baseType | `鹰翼 慧眼` / `劫掠者之帽` | name 仅展示，base type 进入查询 |
| itemLevel | `82` | 展示；是否过滤由用户选择 |
| quality | `20` | 面板属性 |
| evasion | `{ value: 1153, augmented: true }` | 最终闪避面板值，不是某一条词缀值 |
| sockets | `S S` | 展示 |
| footer flags | `引路石掉落` | 掉落来源，不是 modifier |

预期 modifier 及官方国服 Stats 匹配：

| 来源 | valueMode | 当前文本与数值 | 有效 Stat ID | 默认选择 |
| --- | --- | --- | --- | --- |
| enchant | fixed-option | `配置 奇术发生器` -> `[]` | `enchant.stat_2954116742\|56666` | 否 |
| rune | numeric | `全属性 +50` -> `[50]` | `rune.stat_2897413282` | 否 |
| rune | presence | `渡鸦触碰` -> `[]` | `rune.stat_3198163869` | 否 |
| explicit prefix | numeric | `+206 点闪避值` -> `[206]` | `explicit.stat_53045048` | 是 |
| explicit prefix | numeric | `+141 生命上限` -> `[141]` | `explicit.stat_3299347043` | 是 |
| explicit prefix | numeric | `闪避值提高 76%` -> `[76]` | `explicit.stat_124859000` | 是 |
| explicit suffix | numeric | `+33 敏捷` -> `[33]` | `explicit.stat_3261801346` | 是 |
| explicit suffix | numeric | `冰霜抗性 +38%` -> `[38]` | `explicit.stat_4220027924` | 是 |
| explicit suffix | numeric | `获得相当于闪避值 23% 的偏转值` -> `[23]` | `explicit.stat_3033371881` | 是 |

该 fixture 追加固化以下规则：

1. 稀有度后可以直接出现名称和基底，不要求存在第一件 fixture 中的警告行；警告是可选行。
2. `{ 强化 }` 开启独立的 enchant 区块。`配置 ... — 数值不可调整` 去掉尾部 UI 标记后匹配 catalog；它是固定选项，不显示 Min/Max。
3. 带 `|optionId` 的完整 Stat ID 必须原样保存和提交，不能截成基础 `stat_2954116742`。
4. 符文既可能是 numeric stat，也可能是没有数值的 presence stat；`currentValues=[]` 不代表 unresolved。
5. `全属性 +50` 的语序对应 `全属性 #`，应匹配 `stat_2897413282`；不能只凭关键词误选文本为 `# 全属性` 的 `stat_1379411836`。
6. 护甲上的固定闪避和百分比闪避均为 local 属性，分别补全 `(区域)` 模板并匹配 `stat_53045048`、`stat_124859000`。
7. 最终面板闪避 `1153` 与固定闪避 `206`、闪避提高 `76%` 分开保存，不从面板值反推词缀。
8. enchant 与 rune 首版均展示但默认不勾选；用户可按市场稀缺性主动加入查询。

### 12.8 国服真实样本：传奇库勒马克之握

第三个验证 fixture 是物品等级 82、已腐化的传奇戒指 `库勒马克之握`，基底为 `深渊印戒`。预期核心字段为：

| 字段 | 解析结果 | 查询用途 |
| --- | --- | --- |
| itemClass | `戒指` | 类型校验 |
| rarity | `unique` | 使用 name + type 搜索 |
| name / baseType | `库勒马克之握` / `深渊印戒` | 分别进入查询 `name`、`type` |
| itemLevel | `82` | 展示；是否过滤由用户选择 |
| corrupted | `true` | 默认生成已腐化结构化过滤器，UI 可取消 |
| flavourText | `痛饮魂井之水。`、`任由深渊在血管中游走。` | 仅展示，不参与 Stat 匹配 |
| footer flags | `引路石掉落` | 掉落来源，不是 modifier |

预期 modifier 及官方国服 Stats 匹配：

| 来源 | 显示值 -> 交易值 | 有效 Stat ID |
| --- | --- | --- |
| implicit | presence -> `[]` | `implicit.stat_2646093132`（击中时施加深渊损耗） |
| explicit | `[21] -> [-21]` | `explicit.stat_101878827`（官方模板：在场范围提高 `#%`） |
| explicit | `[20] -> [-20]` | `explicit.stat_1263695895`（官方模板：照亮范围提高 `#%`） |
| explicit | `[8] -> [8]` | `explicit.stat_2748665614`（魔力上限提高） |
| explicit | `[12] -> [12]` | `explicit.stat_458438597`（伤害优先从魔力扣除） |
| explicit | `[42] -> [42]` | `explicit.stat_587431675`（暴击率提高） |
| explicit | `[11] -> [11]` | `explicit.stat_2505884597`（额外冰霜伤害） |
| explicit | `[4] -> [4]` | `explicit.stat_656461285`（智慧提高） |
| explicit | `[1] -> [1]` | `explicit.stat_227523295`（暴击球数量上限） |

该 fixture 追加固化以下规则：

1. 传奇物品查询使用 `name + type`，即 `库勒马克之握 + 深渊印戒`；不能像稀有物品一样丢弃 name。
2. `{ 基底属性 }` 映射到 `implicit`；`— 数值不可调整` 是 UI 标记，去掉后仍可得到 presence stat。
3. `{ 传奇属性 ... }` 在官方 Stats 中仍使用 `explicit` 分组，头部中的光环、魔力、暴击等 tag 只用于展示和候选诊断。
4. 一个 modifier header 可以管辖多条独立词缀。例如魔力头部下的两行分别匹配 `stat_2748665614` 和 `stat_458438597`；伤害头部下的两行也分别匹配两个 ID。只有 catalog 存在对应多行模板时才合并，不能默认“一头一词缀”或“一行一词缀”。
5. catalog 只有“提高”模板时，游戏文本的“降低 N%”仍匹配同一 ID，并使用 `valueTransform='negate'`：`currentValues=[N]`、`tradeValues=[-N]`。
6. 降低幅度的 UI 范围 `[20, 30]` 转换到官方范围后必须交换边界，得到 `{ min: -30, max: -20 }`。不能产生 `{ min: -20, max: -30 }`。
7. 当前值可能超出复制文本显示的基础 tier 范围，例如暴击率当前值 `42`、范围 `(25-40)`。解析器必须原样保留当前值并给出非阻塞诊断，不能裁剪为 40 或判定失败。
8. flavour text、`被腐化` 和掉落来源分别进入不同状态；进入 flavour 后仍允许通过后续分隔线识别 corrupted/footer marker。
9. 已腐化物品初始搜索表单设置 `corrupted=true`，避免默认把不可继续加工的物品与未腐化版本混价；用户可以显式改为不限。

### 12.9 国服真实样本：腐化强化丝克玛便鞋

第四个验证 fixture 是物品等级 80、已腐化的稀有 `丝克玛便鞋`，随机名称为 `灾祸 远道`。该物品同时包含腐化强化、符文、普通显式、亵渎和打造词缀。预期核心字段为：

| 字段 | 解析结果 | 查询用途 |
| --- | --- | --- |
| itemClass | `鞋子` | 类型校验和防御属性语义 |
| rarity | `rare` | 只用 base type 搜索 |
| name / baseType | `灾祸 远道` / `丝克玛便鞋` | name 仅展示，base type 进入查询 |
| itemLevel | `80` | 展示；是否过滤由用户选择 |
| quality | `20` | 面板属性 |
| energyShield | `{ value: 191, augmented: true }` | 最终面板值，不是百分比词缀值 |
| sockets | `S` | 展示 |
| corrupted | `true` | 默认生成已腐化过滤器 |
| footer flags | `引路石掉落` | 掉落来源 |
| cosmeticText | `使用 飞行法令 造型。(可使用shift+左键取下)` | 外观元数据，不参与查询 |

预期 modifier 及官方国服 Stats 匹配：

| 来源 | 当前文本与数值 | 有效 Stat ID | 默认选择 |
| --- | --- | --- | --- |
| corrupted + enchant | `闪电抗性 +23%` -> `[23]` | `enchant.stat_1671376347` | 是 |
| rune | `冰霜抗性 +22%` -> `[22]` | `rune.stat_4220027924` | 否 |
| explicit prefix | `能量护盾提高 92%` -> `[92]` | `explicit.stat_4015621042` | 是 |
| explicit prefix | `移动速度提高 30%` -> `[30]` | `explicit.stat_2250533757` | 是 |
| explicit prefix | `+85 魔力上限` -> `[85]` | `explicit.stat_1050105434` | 是 |
| explicit suffix | `闪电抗性 +33%` -> `[33]` | `explicit.stat_1671376347` | 是 |
| desecrated suffix | `+15% 火焰与混沌抗性` -> `[15]` | `desecrated.stat_378817135` | 是 |
| crafted suffix | `火焰抗性 +32%` -> `[32]` | `crafted.stat_3372524247` | 是 |

该 fixture 追加固化以下规则：

1. `{ 腐化强化 ... }` 的有效 Stats 分组是 `enchant`，同时在 `sourceTags` 保留 `corrupted`；不能创建官方并不存在的 `corrupted.*` ID。
2. 相同模板 `闪电抗性 #%` 同时出现在腐化强化和普通后缀时，必须分别得到 `enchant.stat_1671376347` 与 `explicit.stat_1671376347`。文本相同不能合并，也不能去重。
3. 腐化强化是物品永久结果，初始表单默认勾选；普通可替换 rune 仍默认不勾选。这比对所有 enchant 使用同一默认值更符合可比价格范围。
4. `能量护盾提高 #%` 的当前官方模板没有 `(区域)` 后缀，可直接匹配 `stat_4015621042`。Local/Global 补全必须由 catalog 候选驱动，不能给所有护甲防御词缀机械添加 `(区域)`。
5. `+15% 火焰与混沌抗性` 的数字位于文本开头，规范化后匹配 `#% 火焰与混沌抗性`；来源头决定使用 `desecrated` 分组。
6. `被腐化`、`引路石掉落` 后仍可能出现由单独分隔线包围的外观说明。解析器需要 `COSMETIC_OR_NOTE` 状态，不能假设掉落来源一定是全文最后一行。
7. `使用 ... 造型` 和括号内的 Shift 操作提示只进入 `cosmeticText`。它们不得成为 unresolved modifier，也不应作为普通解析警告。
8. 面板能量护盾 `191` 与词缀 `能量护盾提高 92%` 分开保存；不得从最终面板值反推基础防御或词缀范围。

## 13. Stat 模板规范化与匹配

### 13.1 规范化

规范化只用于建立候选，不修改用户看到的原文：

1. Unicode 和空白规范化。
2. 清理官方显示格式标记，例如 `[key|value]`。
3. 去掉物品复制文本中的 tier 范围注释 `(15-30)`，保留当前值。
4. 把整数、小数和带符号数字替换为 `#`。
5. 统一百分号、加号和连接符的可接受差异。
6. 保留换行语义，用于多行 Stat。

### 13.2 匹配优先级

1. `source type + normalized full text` 精确匹配。
2. `normalized full text` 精确匹配，得到唯一 ID。
3. 多行组合与 catalog 模板精确匹配。
4. 可解释的格式差异匹配，例如可选加号、空白差异。
5. 仍有多个候选时返回 ambiguous，由 UI 让用户选择或取消该条件。
6. 无候选时 unresolved，不进入查询。

第一版不允许把 Levenshtein 最近项自动当成正确 Stat ID。模糊候选可以用于诊断或人工选择，但不能静默提交。

### 13.3 Local/Global

Local/Global 不使用固定字符串替换表作为主流程。优先依赖：

- 官方 Stats 返回的不同文本模板。
- modifier source。
- 物品类型，例如 weapon/armour。
- 完整文本中的 `(Local)`、`(区域)` 等标记。

若确实存在官方文本无法区分但 API 需要不同 ID 的案例，应建立小型、可测试、带来源说明的 override 表；每条 override 必须有真实剪贴板 fixture 和查询测试。

### 13.4 数值极性

游戏复制文本可能把负方向的同一底层 Stat 显示成正数加“降低/reduced”，而官方 catalog 只提供“提高/increased”模板。该处理属于可解释的语义匹配，不是模糊匹配：

1. 各语言 profile 定义提高/降低的成对语义标记。
2. matcher 先用原始方向精确匹配；无候选时才尝试同一完整模板的反方向形式。
3. 反方向匹配成功时记录 `valueTransform='negate'`，保留原始 display text 和 `currentValues`。
4. `tradeValues`、用户输入的 Min/Max 和 tier 范围均通过同一纯函数转换；区间变换后统一按数值重新排序边界。
5. 只有除方向词以外完整文本、source 和结构都匹配时才允许转换，不能仅因包含“降低”就选取任意“提高”Stat。

## 14. 搜索条件模型

```ts
export interface TradeSearchForm {
  league: string
  name?: string
  type?: string
  rarity?: TradeItemRarity
  itemLevel?: RangeFilter
  quality?: RangeFilter
  armour?: RangeFilter
  evasion?: RangeFilter
  energyShield?: RangeFilter
  corrupted?: boolean
  identified?: boolean
  status: 'online' | 'any'
  modifiers: TradeModifierFilter[]
}
```

`TradeSearchForm` 是 renderer 可编辑的表单，不包含 realm。主进程接收表单后，从已同步的 `AppSettings.defaultRealm` 获取 realm，并生成只在主进程内部使用的 resolved request。这样不会出现全局设置为国服、查价表单却提交国际服的双重状态。

规则：

- 传奇：优先 `name + type`。
- 稀有/魔法/普通：按 `type`，不提交随机物品名。
- 默认只查询 `sale_type=priced`。
- modifiers 默认 `and`。
- unresolved/ambiguous modifier 不得进入请求。
- 仓库中保存的 resolution 只是缓存；Query Builder 前必须由 `TradeStatResolver` 使用当前 realm catalog 复核，`stale` 不得进入请求。
- 市场收藏、PoB 导入、装备界面收藏和剪贴板查价生成的 `TradeModifierFilter` 必须完全相同，不能按入口分叉查询语义。
- Min/Max 为空时只要求存在该 Stat，不自动用物品当前值做精确匹配。
- 用户显式填写 Min/Max 后才提交数值范围。

建议默认市场状态为 `online`，并允许切换为 `any`。这样首屏更接近可交易价格，同时保留查看全市场的能力。

## 15. 查询与结果

### 15.1 Search

Query Builder 输出普通 JSON 对象并通过 snapshot test 验证。示例：

```json
{
  "sort": { "price": "asc" },
  "query": {
    "status": { "option": "online" },
    "type": "示例基底",
    "stats": [
      {
        "type": "and",
        "filters": [
          {
            "id": "explicit.stat_example",
            "value": { "min": 30 }
          }
        ]
      }
    ],
    "filters": {
      "trade_filters": {
        "disabled": false,
        "filters": {
          "sale_type": { "option": "priced" }
        }
      }
    }
  }
}
```

### 15.2 Fetch 与分页

- 每页最多 10 个 ID。
- renderer 保存分页视图状态，主进程保存 search context。
- renderer 不能传任意 result ID；主进程只接受当前 search context 中的页码。
- search context 设置短期过期时间，防止长期复用失效查询。

### 15.3 结果模型

```ts
export interface TradeListingView {
  id: string
  indexedAt?: string
  seller: {
    accountName?: string
    online?: boolean
  }
  price?: {
    amount: number
    currency: string
    display: string
  }
  item: TradeListingItemView
  whisper?: string
}
```

只把 UI 需要的字段传给 renderer，避免直接暴露庞大且可能变化的官方响应。

### 15.4 价格摘要

第一版的权威输出是挂牌列表，而不是单一估值。可以展示以下描述性统计，但必须明确是“当前查询结果”：

- 有价格样本数。
- 最低若干条价格。
- 按同一通货分组的中位数。
- 数据获取时间。

不同通货之间不做隐式换算，除非未来引入对应区服、对应赛季且来源明确的汇率服务。

## 16. IPC 契约

建议命名：

```text
price-check:get-settings
price-check:update-settings
price-check:set-app-context
price-check:get-auth-state
price-check:login
price-check:logout
price-check:refresh-reference-data
price-check:parse-text
price-check:search
price-check:fetch-page
price-check:cancel
price-check:open-trade-page
price-check:copy-whisper
price-check:save-to-library

price-check:event-item-copied
price-check:event-status
price-check:event-error
```

所有 handler 必须：

1. 检查发送方属于主窗口或查价窗口。
2. 使用 runtime validator 检查 payload。
3. 限制字符串长度、数组数量和页码范围。
4. 不接受 renderer 提供的任意 URL、文件路径或 Cookie。
5. 返回稳定 DTO，不直接透传 Electron 对象或上游 Response。

`price-check:save-to-library` 只接受当前 generation 内已经由主进程解析的 item context ID、备注和有限标签，不能接受 renderer 回传任意完整装备对象。主进程从当前 context 构造 `price-check` 来源并调用共享 `EquipmentLibraryRepository`。

preload 只暴露窄接口，例如：

```ts
window.superpoePriceCheck.search(form)
window.superpoePriceCheck.fetchPage(page)
window.superpoePriceCheck.login()
```

## 17. 设置模型

系统级查价设置由主进程保存到 `{app.userData}/price-check/settings.json`，通过 `price-check:get-settings/update-settings` 读取和修改：

```ts
interface PriceCheckSettings {
  enabled: boolean
  hotkey: string
  statusFilter: 'online' | 'any'
  rememberWindowPosition: boolean
}
```

这里刻意不包含 `realm` 和 `league`：

- 当前区服始终读取项目级 `AppSettings.defaultRealm`。
- 赛季列表始终来自对应区服 `/data/leagues`。
- 默认自动选择当前挑战赛季，不在全局设置中增加赛季字段或赛季下拉框。
- 查价窗口可以提供紧凑的赛季选择，用于永久区、专家区或特殊赛季；该选择只属于查价上下文。
- 如果需要跨启动记忆非默认赛季，按 realm 写入主进程的 `trade-preferences.json`，不进入全局 `AppSettings`，也不改变构筑默认服务器。

`/data/leagues` 当前响应没有 `current`/`challenge` 布尔字段。选择规则必须确定且不依赖中英文名称猜测：若该 realm 记忆的 league ID 仍存在则沿用；否则选择官方响应的第一项。2026-07-29 两区服第一项分别是 `奥杜尔秘符` 和 `Runes of Aldur`。如果未来官方排序契约变化，UI 仍展示实际选中值并允许用户修正。

设置页可增加“查价器”分区管理启用状态和热键，但只保留现有“腾讯服/国际服”分段选择，不在查价器分区重复提供区服或赛季。

现有 `AppSettings.defaultRealm` 继续保存在 renderer `localStorage`。主窗口加载后必须立即同步 `{ defaultRealm }`，每次修改后再次同步；主进程在收到首次同步前将 PriceCheck 标记为 `context-not-ready`，不得用硬编码默认区服执行热键搜索。系统级热键设置不能只放在 renderer localStorage，否则主进程启动阶段无法可靠注册。

## 18. 查价窗口设计

### 18.1 BrowserWindow

建议：

- 独立 `BrowserWindow`。
- `frame: false`。
- `alwaysOnTop: true`。
- `skipTaskbar: true`。
- 初始宽度约 620px，高度按内容约束。
- 支持拖动和记忆位置。
- `Esc` 关闭。
- 不使用透明窗口作为第一版基础，降低 Windows 合成和点击问题。

窗口使用同一 Vite 构建产物的独立入口，不为查价器再启动 HTTP 服务。当前项目没有 React Router，最小接入方式是在 `src/main.tsx` 先读取 `?surface=price-check`，再动态 `import('./priceCheck/PriceCheckApp')` 或 `import('./App')`。必须在导入和挂载 `<App />` 前分流，否则查价窗口不仅会初始化天赋树、PoB Lua 和构筑数据，还会下载当前约 789 KB 的主应用 JS chunk。静态 import 两个 App 后再条件渲染不满足隔离要求；Vite 多 HTML entry 也可接受，但不是第一选择。

开发环境加载 `${rendererUrl}?surface=price-check`，打包环境加载 `app://localhost/index.html?surface=price-check`。现有 custom `app://` protocol 可以承载该 query route。

查价窗口使用独立 `electron/priceCheck/preload.ts`，只暴露 PriceCheck IPC。不能复用现有 preload 后把 `calculatePobLua`、写构筑文件等无关能力暴露给查价窗口。窗口设置 `contextIsolation:true`、`nodeIntegration:false`，并优先启用 `sandbox:true`。

记忆窗口位置时保存逻辑坐标；恢复前用 Electron `screen` 将 bounds 钳制到当前有效 display 的 `workArea`。多显示器断开、DPI 变化或保存位置完全不可见时，回退到游戏窗口所在显示器右侧可见区域。主窗口现有 UI 缩放只对调用 IPC 的 sender 生效，查价窗口需要在创建或加载后单独应用缩放。

### 18.2 配置态

展示：

- 物品名称、基底、稀有度和核心面板。
- 解析警告。
- 结构化过滤项。
- 每条词缀的勾选状态、当前值、Min/Max 和匹配状态。
- 区服、赛季和在线状态。
- 搜索命令。

ambiguous Stat 必须显示候选选择；unresolved Stat 默认禁用并显示原因。

### 18.3 结果态

展示：

- 查询摘要和更新时间。
- 结果总数、当前页。
- 挂单价格、卖家状态和物品详情。
- 上一页/下一页。
- 返回修改条件。
- 打开官方交易页。
- 复制私聊。

### 18.4 UI 语言与物品文本语言

现有应用 UI 支持 `en`、`zh-rCN`、`zh-rTW`、`ko-KR`。PriceCheck 的 UI 文案应接入现有 `useTranslation`，四种 UI locale 至少都有可读文案或明确的英文 fallback；不能把 UI locale 当成剪贴板语言。

第一阶段剪贴板 parser profile 仍限定为 `zh-CN`、`en`、`zh-TW`。`ko-KR` 只是现有 UI locale，不代表已经支持韩文游戏物品；在取得韩文真实 fixture 和 Global 官方可匹配 catalog 前，应显示“暂不支持该物品文本语言”，不得错误搜索。

## 19. 日志与诊断

建议事件：

```text
hotkey.registered / hotkey.failed
clipboard.copy.started / clipboard.copy.failed
item.parse.succeeded / item.parse.failed
reference-data.cache.hit / reference-data.cache.miss / reference-data.refresh.failed
trade.auth.expired
trade.search.started / trade.search.completed
trade.fetch.completed
trade.rate_limited
```

日志要求：

- 不记录 POESESSID。
- 原始物品文本默认不进普通日志。
- 诊断导出必须由用户显式触发，并允许用户查看将导出的物品文本。
- 请求体可以在开发日志记录，但要限制长度并确保没有 Cookie。
- 每次查价使用 correlation ID，便于串联 copy/parse/search/fetch。

## 20. 测试方案

### 20.1 Parser 单元测试

fixture 至少覆盖每种语言：

- 普通物品。
- 魔法物品。
- 稀有武器。
- 稀有护甲。
- 传奇首饰。
- 咒符。
- 未鉴定物品。
- 腐化物品。
- 带符文物品。
- 稀有度后、第一分隔线前带客户端警告的物品。
- modifier header 同时包含 fractured 与 crafted 状态的物品。
- desecrated modifier。
- footer 含物品状态和掉落来源标记的物品。
- `{ 强化 }` 固定配置和带 `|optionId` 的 enchant。
- 没有数值的 presence rune。
- 传奇 name + type、implicit、flavour、corrupted 和 footer 的完整状态转换。
- 一个传奇 modifier header 下包含多条独立 Stat。
- “降低”文本匹配“提高”模板并转换为负交易值。
- 当前值超出显示 tier 范围。
- 腐化强化与同文本普通显式词缀并存。
- footer 后继续出现外观效果和操作提示。
- 多行词缀。
- Local 与 Global 同名词缀。
- 格式异常和不完整剪贴板。

四份简中原文已保存在 `docs/price-check-fixtures/zh-CN/*.txt`。进入实现时把它们复制为 `src/priceCheck/__fixtures__/` 的可执行 fixture，并补充预期解析 JSON、采集 realm、客户端语言和游戏版本；设计表格和原始 `.txt` 都不能替代 snapshot 断言。

### 20.2 Stat 匹配测试

- 数字与小数替换。
- 正负号。
- tier 范围剥离。
- 显式 `+` 与 catalog 无 `+` 的可解释匹配。
- 武器局部攻击速度匹配 `(区域)` 模板，不误选全局模板。
- 无 header 的符文区块按上下文限定到 rune 分组。
- fractured + crafted 复合状态使用 fractured 分组并保留全部 source tags。
- `currentValues=[]` 的 presence stat 和 fixed-option stat 仍能 resolved。
- 固定选项 ID 保留 `|optionId`，不显示或提交数值范围。
- 护甲局部固定防御和百分比防御匹配 `(区域)` 模板。
- `negate` 变换同时转换当前值和范围，并正确交换 Min/Max。
- 同一 header 下的相邻单行 Stat 不被错误合并。
- 当前值超出 tier 范围时保留原值，只产生非阻塞诊断。
- 同文本、不同 source 的 Stat 分别解析且不去重。
- `{ 腐化强化 }` 选择 enchant 分组并保留 corrupted tag。
- 多行模板。
- source type 限定。
- 唯一、ambiguous、unresolved 三种结果。
- 国服和国际服 catalog 严格隔离。

### 20.3 Query Builder 测试

- 传奇 name+type。
- 稀有仅 type。
- structured filters。
- 多词缀 `and`。
- Min-only、Max-only、Min+Max。
- online/any。
- unresolved 不进入 JSON。

### 20.4 Electron 主进程测试

- IPC payload 校验。
- renderer 不能读取 Cookie。
- realm persistent partition 隔离、Cookie 状态不出主进程和按 realm 注销。
- 缓存原子写入和损坏恢复。
- realm 切换取消旧请求。
- 401、429、timeout 映射。
- result ID 不能越过当前 search context。

### 20.5 集成测试

CI 不依赖实时官方接口，使用脱敏响应 fixture 和 mock fetch。发布前进行国服与国际服人工 smoke test：

1. 登录。
2. reference data 下载。
3. 游戏内复制。
4. 解析。
5. 搜索。
6. Fetch 与翻页。
7. 重新触发热键。
8. 退出后 persistent session 和缓存恢复。

### 20.6 当前测试配置接入

当前 `npm run test:ci` 使用 `vitest.client.config.ts`，只包含 `src/engine/**/*.test.ts`；即使新增 `src/priceCheck/*.test.ts`，CI 也不会自动执行。实现时必须把 `src/priceCheck/**/*.test.ts` 加入该 config，或新增专用 `test:price-check` 并在两份 GitHub Actions workflow 中调用。

`electron/priceCheck/` 也不在现有 Vitest include 内。缓存、限流、session 状态机和 IPC validator 应尽量拆成无 Electron 依赖的函数后纳入 Node 环境测试；BrowserWindow、session 和 globalShortcut 边界使用 mock/适配层测试，并由 Windows 打包 smoke test 覆盖真实系统能力。

当前项目没有 jsdom、React Testing Library 或 Playwright。第一版不把新增完整前端测试栈设为领域层开工前置，但 Phase 3 至少要增加 PriceCheck 状态 reducer/view-model 测试，并对打包后的窗口路由、加载成功、尺寸约束和重复热键行为做自动化或明确记录的人工验证。

## 21. 分阶段实施

### Phase 0：技术验证

- 验证国服和国际服 `/data/stats` 响应结构及认证要求。
- 固化当前 Stat catalog 统计、重复 ID fixture、固定 option ID 和跨 realm resolution 降级测试。
- 确认两区服官方 API/工具政策、可联系 User-Agent 和发布边界；限流实现遵循响应头，不绕过验证。
- 验证两区服 `/data/items`、`/data/filters`、`/data/static` 的消费字段和缓存 validator。
- 验证 `/data/leagues`、Search、Fetch。
- 验证国服登录完整跳转链、允许导航域名、persistent partition Cookie 和 `session.fetch`；确认国际服匿名 Search/Fetch。
- 验证 Windows `SendInput` 与 Electron 打包方案。
- 验证 Windows 原生输入方案不会破坏 macOS arm64 的现有构建矩阵，并补充平台能力检测。
- 验证独立 preload、`?surface=price-check` 路由及 `electron/**/*.ts` 编译输出路径。
- 验证 Market 隔离 preload 能从真实新版 listing 提取最小引用、注入收藏按钮，并从 Fetch 响应取得官方 Stat/hash 关系。
- 收集简中、英文、繁中真实剪贴板 fixtures。
- 验证国际服繁体名称/基底如何映射到搜索接受值。

完成标准：双区服各完成一次手工 Search + Fetch，国服登录可跨重启恢复，并能在 Windows 打包版稳定取得物品文本；macOS 构建仍成功且明确显示系统捕获暂不支持。

### Phase 1：领域层与官方数据

- 类型和 runtime validators。
- realm profiles。
- stats/items/filters/static/league client、validator 与缓存。
- item parser。
- 共享 `TradeStatResolver` 与可持久化 resolution snapshot。
- query builder。
- `EquipmentLibraryEntry`、来源联合类型、fingerprint 和 Repository validator。
- 全量纯函数测试。

完成标准：市场 Fetch、PoB item、装备面板与剪贴板 fixtures 经过同一 resolver 生成可验证 resolution 和双区服查询 JSON；同一装备多来源入库保持幂等。

### Phase 2：Electron 系统能力

- 热键。
- 游戏窗口识别。
- 输入模拟和剪贴板。
- coordinator、取消和 generation。
- realm session manager 与登录窗口。
- 内嵌 Market、认证窗口和 PriceCheck 共用 session、reference cache、Provider 与仓库。
- IPC。

完成标准：不打开主查价 UI，也能通过开发诊断窗口跑通 copy -> parse -> search -> fetch。

### Phase 3：查价窗口

- 配置态。
- modifier 选择和 Min/Max。
- 登录/缓存/限流状态。
- 结果列表和分页。
- 打开官方页面、复制私聊。
- 保存到统一装备仓库，并展示该装备已有来源。
- 主设置页入口。

完成标准：国服与国际服均可完成完整用户流程，窗口不阻断游戏基本操作。

### Phase 4：稳定性与发布

- 错误本地化。
- 日志与诊断导出。
- 打包后的原生输入验证。
- Windows 常见缩放、全屏窗口化、管理员权限场景。
- API schema 变化保护。
- 性能和内存检查。

完成标准：自动测试通过，打包版双区服 smoke test 通过，不泄露凭据。

## 22. 验收标准

### 功能

- 国服能通过隔离 session 登录；国际服匿名可用且 session 与国服隔离；两区服都能独立缓存数据、选择赛季、搜索和 Fetch。
- 简中与英文游戏物品主流程可用；繁中支持以 Phase 0 验证结果为准，但不得错误搜索。
- 快速连续触发热键不会显示旧物品结果。
- 无匹配词缀不会被静默映射到错误 ID。
- 401、429、网络失败和接口结构变化有明确状态。

### 安全

- renderer 和日志都无法取得 POESESSID 原文。
- IPC 不接受任意 URL、文件路径或查询 ID。
- POESESSID 运行时只存在于 realm 专属 Chromium CookieStore；跨重启副本只以 `safeStorage` 密文保存在主进程凭据文件中。
- 缓存只包含官方公开 reference data，不包含账号 Cookie。

### 工程质量

- parser、resolver、query builder、装备 fingerprint 和多来源仓库有双区服 fixtures 和单元测试。
- live API 不进入 CI 必要条件。
- 主进程网络与 renderer UI 解耦。
- 不修改 `public/pob-lua` 生成产物来实现查价逻辑。
- 不引入 Xiletrade。
- Windows 打包版完成游戏内捕获；macOS 构建不因 Windows 原生依赖失败，并明确报告能力不可用。

## 23. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 官方 API schema 变化 | 搜索或解析失败 | runtime validation、稳定错误码、原始 cache envelope |
| Stats 文本与游戏复制文本不完全一致 | Stat unresolved | 分层规范化、source 限定、ambiguous UI、真实 fixtures |
| 国际服繁体名称无法直接搜索 | 名称/type 查询失败 | Phase 0 验证官方本地化 items 映射，禁止猜测翻译 |
| 429 限流 | 用户等待或失败 | realm 独立限流、Retry-After、取消与倒计时 |
| User-Agent/官方政策不满足 | 请求被限制或发布风险 | Phase 0 确认可联系身份、官方工具边界和限流要求 |
| POESESSID 失效 | 搜索 401 | 明确 auth 状态、快速重新登录 |
| 游戏管理员权限更高 | 无法注入 Ctrl+C | 明确诊断，必要时同权限运行，不静默读取旧剪贴板 |
| Electron 原生输入模块打包失败 | 热键流程不可用 | Phase 0 先验证打包产物，再进入 UI 开发 |
| 模糊匹配错误 | 展示无关价格 | 首版禁止自动模糊提交，歧义必须人工确认 |

## 24. 待确认产品决策

以下事项不阻塞 Phase 0，但应在 Phase 3 前确认：

1. 默认市场状态使用 `online` 还是 `any`。本文建议 `online`。
2. 第一版是否展示同币种中位数。本文允许展示描述性统计，但不输出跨币种“建议价格”。
3. 悬浮窗是否在失去焦点后保持可交互，还是提供“锁定/穿透”模式。本文第一版不启用鼠标穿透。
4. 是否恢复用户触发查价前的剪贴板内容。本文默认不恢复。
5. 是否接受第一版仅 Windows 支持游戏窗口识别和自动 Ctrl+C；macOS 保持构建通过并显示暂不支持。本文建议接受该边界。
6. 查价热键功能首次安装默认启用还是关闭。为避免与现有宏冲突，本文建议默认关闭，由用户在设置中启用并确认 `Ctrl+D`。
7. 官方 API `User-Agent` 需要可联系的项目身份。发布前必须确定仓库 URL、项目主页或维护邮箱，不能只发送匿名的产品名/version。

## 25. 与集市和装备仓库的统一交付

内嵌集市、页面 listing 收藏和统一装备仓库不再是查价器完成后的可选扩展，而是路线图 M0 的共享基础。详细边界见 `marketplace-browser-design.md`。M0/M6 必须共同交付以下稳定契约：

- `TradeSessionManager`、`TradeReferenceDataCache`、`TradeStatResolver`、`OfficialTradeProvider` 和 `EquipmentLibraryRepository` 各只有一个实现。
- 市场收藏、PoB 导入、装备界面收藏和查价保存都写入统一仓库并保留来源。
- 页面注入按钮只传 listing 引用；官方 Fetch、校验、解析和写盘都在主进程完成。
- 仓库词缀保留原始证据、观察值和带 catalog hash 的 resolution snapshot。

在这些共享契约之上继续扩展：

- 把候选装备转换为 SuperPoE2/PoB Item。
- 代入当前构筑计算 DPS、防御和资源变化。
- 按提升率、价格和单位收益排序。
- 保存历史查询与价格快照。
- 当前装备与市场候选并排比较。
- 游戏内直接显示“价格 + 构筑提升”组合提示。

这些扩展必须复用第一阶段稳定的 `LibraryItemSnapshot`、`ParsedTradeItem`、`TradeSearchForm` 和 `TradeListingView`，不得让上游 API DTO 直接进入构筑领域模型。

## 26. 当前项目落地审计（2026-07-29）

### 26.1 结论

`D:\sources\superpoe` 的 Electron + React/Vite 技术栈可以承载本设计，不需要更换框架或引入本地服务。当前工作树已经具备集市入口、`WebContentsView`、基础导航、realm partition 和登录状态检查，但尚无共享 Trade Provider、reference-data cache、`TradeStatResolver`、listing validator、统一装备仓库或游戏内热键查价闭环。PriceCheck 应接入统一交易领域，不能扩写 PoB Lua 装备解析来承担中文交易文本，也不能与 Market 分别实现 parser/API client。

审计时当前工作树基线验证通过：`npm run test:ci` 为 24 个测试文件、144 个测试全部通过，`npm run build:electron:main` 和完整 `npm run build` 均成功。完整构建存在 Vite 的现有大 chunk 警告，因此独立 PriceCheck 动态入口属于性能要求，不只是代码组织偏好。

### 26.2 可直接复用

| 当前能力 | 位置 | 复用方式 |
| --- | --- | --- |
| `BuildRealm = 'cn' \| 'global'` | `src/types/tree.ts` | `TradeRealm` 可直接别名或使用同一窄类型 |
| `AppSettings.defaultRealm` | `src/engine/appSettings.ts` | 作为唯一搜索 realm，经 IPC 同步给主进程 |
| Electron custom `app://` protocol | `electron/main.ts` | 加载打包后的 `?surface=price-check` renderer |
| contextBridge + IPC 模式 | `electron/preload.ts` | 沿用模式，但查价窗口使用专属 preload |
| React 18、Lucide、现有工作台视觉 | `src/`、`src/index.css` | PriceCheck 组件沿用字体、颜色、命令按钮和错误状态 |
| Vitest Node 测试 | `vitest.client.config.ts` | 覆盖 parser/matcher/query builder，需扩大 include |
| Windows/macOS electron-builder 和 CI | `package.json`、`.github/workflows/` | 验证 Windows 能力且不破坏 macOS 构建 |
| `app.userData` 已在 ready 前固定 | `electron/main.ts` | 存放 realm session、reference cache 和 PriceCheck 设置 |

### 26.3 不能直接复用

| 当前能力 | 原因 | 处理 |
| --- | --- | --- |
| `parseEquipmentXml` | 解析英文 PoB XML item，不解析游戏复制区块、中文头部和 tier range | 保持原样，新增 `itemTextParser` |
| `EquipmentModifierGroup` | 只有 enchant/rune/implicit/explicit，缺少 fractured/crafted/desecrated/复合状态 | PriceCheck 使用独立类型，不修改构筑领域模型 |
| `public/data/item-bases.json` | 仅英文 PoB 基底键，国服名称缺失 | 交易名称以 realm `/data/items` 为准；现有数据只辅助国际服面板语义 |
| `equipmentAffixes` 正则 | 面向英文构筑展示和汇总，不提供官方 Stat ID | 不用于 `TradeStatResolver` |
| updater/poe2db 网络代码 | 无 realm session、交易限流和上游 DTO validator | 在 `electron/trade/` 新建共享 `TradeApiClient`，只复用错误处理风格 |
| 主窗口 preload | 暴露 PoB 计算和构筑文件能力 | overlay 使用独立窄 preload，login window 不使用 preload |

### 26.4 必须修改的现有接入点

1. `tsconfig.electron.json`：include 改为 `electron/**/*.ts`，确保子目录和专属 preload 被编译。
2. `electron/main.ts`：保存 main window 引用，初始化/释放共享 Trade 服务、Market view 和 PriceCheck 服务，增加首次 app-context 握手和严格 sender 校验；业务实现放子模块，避免继续膨胀当前 main 文件。
3. `electron/preload.ts` 与 `src/electron.d.ts`：主窗口只增加设置同步、状态和设置入口所需的窄 API；overlay 类型与桥接放专属 preload。
4. `src/App.tsx`：启动和 `defaultRealm` 修改后同步 context；浏览器开发模式下把系统能力标记为不可用。
5. `src/main.tsx`：挂载前按 `surface` 动态 import 分流，避免 overlay 初始化或下载完整构筑应用。
6. `src/components/GlobalSettingsDialog.tsx`：增加启用状态、热键和注册错误，但不重复区服/赛季。
7. `vitest.client.config.ts` 和两份 workflow：确保 PriceCheck 测试实际进入 CI。
8. `package.json`/electron-builder：按 Phase 0 选定的 Windows 输入方案增加依赖或 `extraResources`，并做平台条件加载。
9. 生产 renderer：补充与现有远程图片需求兼容的 CSP；官方交易请求仍只在主进程发起。

### 26.5 全新能力

- Windows POE2 窗口识别、前台校验、权限诊断和受限 Ctrl+C 输入。
- 全局热键注册与主进程持久设置。
- realm persistent session、内嵌集市/认证窗口共享登录态、国服登录和国际服匿名模式。
- 五类官方 reference-data client、runtime validator、原子缓存和内存索引。
- 中文/英文/繁中剪贴板 parser、Stat matcher、查询构建和真实 fixtures。
- Search/Fetch 限流、取消、generation 和主进程 search context。
- 独立 PriceCheck renderer、结果 DTO、窗口布局和诊断状态。

### 26.6 实施前仍缺的证据

1. Windows 打包版对 POE2 的窗口类名、前台句柄、`SendInput` 和管理员权限行为验证。
2. 国服登录的真实 QQ/WeGame 跳转域名、Cookie 持久化和 `session.fetch` Search + Fetch 闭环。
3. 国际服英文真实剪贴板 fixture、Search + Fetch 闭环；繁中基底如何映射到 Global `/data/items`。
4. 为 `docs/price-check-fixtures/zh-CN/` 的四份原始样本补完整预期 JSON、游戏版本元数据和可执行 snapshot fixture。
5. `/data/filters` 到结构化 query JSON 的真实 snapshot，包括 quality、item level、corrupted、defence、weapon filters 和 sale type。
6. 官方交易页面 URL 构造规则和两个 realm 的 allowlist 验证。
7. 官方 API 可联系的 `User-Agent` 身份。

在 1、2 未验证前可以先实现纯领域层，但不能承诺游戏内热键闭环；在 3 未验证前不能宣称国际服完成。
