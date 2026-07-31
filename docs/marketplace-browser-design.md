# SuperPoE2 集市浏览、页面增强与统一装备仓库设计

> 状态：M0 应用侧与搜索收藏 O0 已实现；实时购买目标监控待实施，整体待真实站点 smoke test
> 更新日期：2026-07-31
> 适用项目：`D:\sources\superpoe`
> 关联设计：[price-check-design.md](./price-check-design.md)
> 订阅设计：[market-subscription-design.md](./market-subscription-design.md)

> 实现说明：双区服 `WebContentsView`、隔离 market preload、官方 Fetch 校验、统一多来源仓库、侧栏/独立仓库界面、仓库官方搜索和搜索收藏 O0 已接入。公开会话无法越过腾讯登录与 Cloudflare，因此新版 listing DOM Adapter、官方搜索请求快照捕获和收藏恢复仍需在用户 Electron 登录分区中验收。

## 1. 结论

当前 Electron + React 架构可以实现内嵌官方集市、登录态持久化、页面事件捕获、扩展界面和本地装备收藏，不需要 Xiletrade，也不需要新增本地 Web 服务。

推荐方案：

1. 上方工作区增加 `market`（集市）Tab。
2. Electron 主进程使用 `WebContentsView` 加载当前全局区服对应的官方交易网站。
3. 集市网页和 PriceCheck 的 Trade2 API 请求共用同一个 realm persistent session。
4. Cookie 日常使用仍由 Electron Chromium CookieStore 管理；为兼容官方会话 Cookie，主进程额外使用 `safeStorage` 保存按区服隔离的加密凭据快照，renderer 与日志不得读取原文。
5. 页面增强使用隔离 preload + realm DOM Adapter，在 listing 卡片内注入轻量收藏按钮，但不向远程页面暴露 SuperPoE2 主窗口能力。
6. 收藏不是独立数据表，而是装备进入统一仓库的一种来源；市场收藏、PoB 导入、装备界面收藏和游戏内查价共享同一个 `EquipmentLibraryRepository`。
7. 仓库保存经过校验的装备快照、来源和可重新验证的 Stat resolution，不能只保存脆弱的网页 DOM 或某次 catalog 的 Stat ID。

可行性评估：

| 能力 | 可行性 | 主要风险 |
| --- | --- | --- |
| 内嵌官方集市完整网页 | 高 | 原生视图边界和弹窗管理 |
| 登录状态跨重启保存 | 高 | 国服 QQ/WeGame 跳转域名需实测 allowlist |
| 登录态供 PriceCheck 复用 | 高 | 所有请求必须取得同一个 Electron session |
| 返回、前进、刷新、主页 | 高 | 无特殊风险 |
| 捕获装备卡片点击/右键 | 中高 | 官方页面 DOM 更新会使 Adapter 失效 |
| 页面卡片增加收藏按钮 | 中 | 依赖 DOM，需版本检测和自动降级 |
| SuperPoE2 仓库侧栏展示装备 | 高 | 必须取得可信 listing DTO 并进入统一仓库 |
| 拦截并改写网页 Fetch/XHR | 低，不建议 | 脆弱且扩大安全和合规风险 |
| 自动购买、自动私聊 | 不做 | 服务条款和产品边界风险 |

## 2. 产品范围

### 2.1 第一阶段

- 顶部导航增加“集市”。
- 区服统一读取 `AppSettings.defaultRealm`，集市内不维护第二套国服/国际服选择。
- 打开对应区服官方交易首页。
- 提供后退、前进、刷新、停止、主页和在系统浏览器打开。
- 用户在官方网页完成登录后，登录状态跨应用重启保留。
- PriceCheck Search/Fetch 自动复用该登录状态。
- 显示当前区服和登录状态，支持重新登录和按区服注销。
- 支持收藏交易结果装备，在 SuperPoE2 统一装备仓库中查看；“市场收藏”只是来源筛选视图。
- 支持严格识别并保存当前官方搜索，维护名称、备注、目录和排序；现有 URL 书签式实现不视为完成。
- 页面增强失效时，官方网页浏览与 PriceCheck API 仍能独立工作。

### 2.2 后续能力

- 从网页选中装备后打开结构化详情面板。
- 仓库装备加入候选比较列表。
- 将候选装备转换为 PoB Item。
- 代入当前构筑计算 DPS、防御和资源变化。
- 用户主动刷新收藏状态或重新搜索同类装备。
- 将已保存的官方搜索启用为购买目标，通过 Trade2 Live WebSocket 接收新 listing，经突发合并、有限 Fetch、有效性校验和排序后，在游戏机会面板展示少量重点候选；详细方案见 [market-subscription-design.md](./market-subscription-design.md)。

### 2.3 不做

- 不自动购买、自动出价或自动发送私聊。
- 不批量模拟用户操作市场页面。
- 不绕过验证码、限流、登录验证或网站策略。
- 不注入第三方脚本，不允许用户执行任意 JavaScript。
- 不把 Cookie、认证 Header 或完整登录跳转参数传给 renderer。
- 不把网页 DOM 当作 Stat、物品或价格数据的事实来源；DOM Adapter 只提取 listing 引用。
- 不承诺任意官方网页版本都能保持增强功能可用。

## 3. 当前项目审计

### 3.1 可复用能力

| 当前能力 | 位置 | 复用方式 |
| --- | --- | --- |
| `AppSettings.defaultRealm` | `src/engine/appSettings.ts` | 集市与 PriceCheck 的唯一 realm 来源 |
| `BuildRealm` | `src/types/tree.ts` | 复用或别名为 `TradeRealm` |
| 顶部工作区 Tab | `src/components/Toolbar.tsx` | `WorkspaceView` 增加 `market` |
| 主工作区切换 | `src/App.tsx` | active view 变化时显示/隐藏 market view |
| Electron 主窗口 | `electron/main.ts` | 保存窗口引用并挂载 `WebContentsView` |
| contextBridge + IPC | `electron/preload.ts` | 增加窄化 market bridge |
| `app.userData` | `electron/main.ts` | session、收藏文件和 UI 状态 |
| PriceCheck 会话设计 | `price-check-design.md` | 共用 `TradeSessionManager` |

### 3.2 当前缺口

- 当前工作树已经有集市工作区、构筑中心入口、`MarketPanel`、基础导航 IPC 和 `WebContentsView` 生命周期管理，但仍属于未提交的基础实现。
- `MarketViewManager` 已使用 realm persistent partition、allowlist 与基础登录检测，但尚未抽成可供 PriceCheck 共用的 `TradeSessionManager`。
- 远程 view 尚未加载专用 market preload，也没有 DOM Adapter、页面收藏按钮、listing 引用事件或按钮状态回传。
- `tsconfig.electron.json` 仍只 include `electron/*.ts`，无法编译建议的 `electron/trade/`、`electron/market/`、`electron/library/` 和专属 preload。
- 主窗口 `sandbox:false` 是现有技术债；远程网页已经使用更严格的 webPreferences，后续不能退回主窗口 preload 或扩大远程 IPC。
- 当前没有共享 `TradeApiClient`、官方 reference-data cache、`TradeStatResolver`、可信 listing validator 或 `EquipmentLibraryRepository`。

### 3.3 入口层级

现有顶部 Tab 属于构筑编辑器，而集市是应用级功能。只把 `market` 加入 `WorkspaceView` 虽然改动最小，但用户必须先打开一个构筑。

建议：

1. 第一阶段把“集市”加入当前顶部 Tab，同时在构筑中心增加同名入口。
2. 后续再把工作区导航提到应用壳层，使构筑中心和编辑器都能直接切换集市。

不建议为第一阶段一次性重写整个 App shell；但构筑中心入口应是验收项。

## 4. 总体架构

```text
AppSettings.defaultRealm
          |
          v
Electron main process
  |- MarketViewManager
  |    `- WebContentsView (official trade website)
  |- TradeSessionManager
  |    |- persist:superpoe-trade-cn
  |    `- persist:superpoe-trade-global
  |- MarketNavigationPolicy
  |- MarketEnhancementCoordinator
  |- EquipmentLibraryRepository
  |- TradeStatResolver
  |- TradeApiClient
  `- OfficialTradeProvider (PriceCheck)
          |
          | validated IPC / events
          v
SuperPoE2 renderer
  |- Market tab and browser toolbar
  |- login/session indicator
  |- equipment library/details side panel
  `- reports content bounds to main

Official remote page
  `- isolated market preload
       |- realm DOM Adapter
       |- debounced MutationObserver
       |- lightweight favorite button decoration
       |- capture-phase event listener
       `- narrow events to main
```

核心约束：`TradeSessionManager` 是会话唯一所有者，`EquipmentLibraryRepository` 是装备入库数据的唯一所有者，`TradeStatResolver` 是词缀到官方查询 Stat 的唯一解析路径。Market、认证窗口和 PriceCheck 不得分别创建 session、仓库或词缀匹配器。

## 5. 嵌入技术

### 5.1 使用 `WebContentsView`

Electron 43 应使用 `WebContentsView`，由主进程创建并挂到主窗口 `contentView`。它加载顶层网页，不受 `<iframe>` 的 `X-Frame-Options` 嵌入限制。

远程内容建议配置：

```ts
{
  partition: realmPartition,
  preload: marketPreloadPath,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}
```

### 5.2 不采用的方案

| 方案 | 原因 |
| --- | --- |
| `<iframe>` | 跨域嵌入和认证受限，无法安全增强页面 |
| `<webview>` | 需要启用 `webviewTag`，安全面和 IPC 复杂度更高 |
| `BrowserView` | 已被 `WebContentsView` 取代 |
| 仅系统浏览器 | 无法在应用内增强，也无法安全共享系统浏览器 Cookie |
| 抓取并重做官网 | 维护成本和合规风险高，偏离使用官方页面的目标 |

### 5.3 原生视图边界

`WebContentsView` 不在 React DOM 内，React CSS 无法控制它的裁剪和层级。必须实现边界协议：

1. `MarketPanel` 用 `ResizeObserver` 获取网页承载区域相对窗口的边界。
2. IPC 发送 `{ x, y, width, height }`。
3. 主进程校验有限整数、最大尺寸和 sender 后调用 `setBounds()`。
4. 切走 Tab、打开应用模态框、最小化或进入构筑中心时隐藏 view。
5. resize、DPI 与 UI scale 变化时重新同步。

远程 view 不能覆盖顶部导航、设置对话框或确认框。打开 modal 前必须隐藏 view，关闭后再恢复。

## 6. 区服、URL 和赛季

```ts
interface MarketRealmProfile {
  realm: 'cn' | 'global'
  partition: string
  homeUrl: string
  allowedNavigationOrigins: string[]
  allowedAuthOrigins: string[]
  listingAdapter: 'cn' | 'global'
}
```

- profile 是主进程静态配置；renderer 不得提交任意 Base URL 或 partition。
- realm 始终跟随全局 `defaultRealm`。
- 切换时隐藏旧 view，取消旧增强任务，选择新区服 session，并恢复该区服上次安全 URL 或主页。
- 两个 realm 的 Cookie、站点存储、页面历史和最后 URL相互隔离并保留。
- 切换不清除另一 realm 的登录状态和仓库来源。
- 市场来源必须记录 realm，仓库默认可按当前 realm 筛选但不能隐藏其他来源导致误删。

赛季不进入全局设置：

- 官方网页赛季由其 URL/页面状态管理。
- PriceCheck 继续通过对应 realm `/data/leagues` 自动选择当前挑战赛季。
- 收藏从可信 listing DTO 记录 `leagueId`。
- 网页赛季与 PriceCheck 当前赛季不一致时显示差异，不能静默混用。

## 7. 登录态共享

### 7.1 Persistent partition

| Realm | Partition |
| --- | --- |
| 腾讯国服 | `persist:superpoe-trade-cn` |
| 国际服 | `persist:superpoe-trade-global` |

`persist:` partition 由 Chromium 自动持久化长期 Cookie、站点 localStorage、IndexedDB 和缓存到 Electron `userData`。官方可能将 `POESESSID` 设置为进程退出即失效的会话 Cookie，因此主进程还要用 Electron `safeStorage` 加密保存凭据快照，并在加载交易页面前恢复到对应 partition。密文按国服和国际服隔离，Cookie 原文不得进入 renderer 或日志。

### 7.2 登录流程

1. 用户进入集市 Tab。
2. Market view 使用当前 realm partition 打开官方集市。
3. 用户在官方网页主动登录。
4. OAuth/QQ/WeGame 弹窗由主进程按 allowlist 创建受限认证子窗口，并使用同一 partition。
5. `TradeSessionManager` 只检查目标 Cookie 是否存在，并用轻量官方请求验证。
6. renderer 只收到 `anonymous/valid/expired/unknown`。
7. PriceCheck 使用同一 session 的 `session.fetch(..., { credentials: 'include' })`。

如果集市页面无法完成认证跳转，可提供受限独立登录窗口作为 fallback，但仍使用同一 partition，不能建立第三套会话。

```ts
interface TradeSessionState {
  realm: 'cn' | 'global'
  status: 'anonymous' | 'valid' | 'expired' | 'unknown'
  checkedAt?: string
  supportsAnonymousSearch: boolean
}
```

### 7.3 注销

- 只清理当前 realm partition 中官方交易/认证 allowlist 域名的 Cookie 与站点存储。
- 清理前确认，并说明会同时退出内嵌集市与 PriceCheck。
- 不清理另一 realm、收藏或 reference-data 缓存。
- 不提供 Cookie 查看、复制、导入或导出。

## 8. 浏览器界面

集市 Tab 顶部使用紧凑工具栏：

- 后退、前进、刷新/停止、主页图标。
- 只读官方域名与页面标题。
- 当前 realm 和登录状态。
- 登录/重新登录命令。
- 装备仓库侧栏开关，并提供“全部、市场收藏、PoB 导入、装备收藏、查价记录”等来源视图。
- 系统浏览器打开图标。

第一版不提供任意 URL 输入。非官方链接交给系统浏览器。网络、证书、HTTP、认证过期和增强不可用应分别显示，不能统一成“网页打不开”。

## 9. 页面增强

### 9.1 安全边界

远程页面使用专属 `marketPreload`：

- 在隔离世界运行。
- 不用 `contextBridge.exposeInMainWorld` 向官方页面暴露 API。
- 只向主进程发送固定类型事件。
- 主进程校验 sender webContents、当前 origin、realm 和 payload 大小。
- 页面脚本不能调用文件、构筑、更新器、PoB Lua 或任意网络 IPC。

### 9.2 Realm DOM Adapter

```ts
interface MarketPageAdapter {
  matches(url: URL, document: Document): boolean
  getVersionSignal(): string
  scanListingCards(root: ParentNode): MarketDomListingRef[]
  extractListingRef(target: EventTarget): MarketDomListingRef | null
  decorateListing(card: Element, state: DecorationState): () => void
  dispose(): void
}
```

国服和国际服分别实现 Adapter。要求：

- 使用稳定语义属性或 URL，不依赖深层 `nth-child`。
- 处理 SPA 路由变化。
- MutationObserver 合并和节流，禁止每次 mutation 全页扫描。
- 标记注入节点，避免重复注入。
- 无法识别页面时停止增强，只保留官方网页。
- 输出 adapter version 和脱敏失败原因，不记录页面全文。

### 9.3 收藏按钮注入与事件捕获

第一阶段必须在官方 listing 卡片内注入轻量收藏按钮。按钮只显示未收藏、处理中、已收藏和失败状态，不承载目录、备注、装备详情或构筑计算。完整管理界面始终位于 SuperPoE2 React 侧栏。

允许观察 listing 点击、收藏按钮、用户主动右键操作、页面内导航与 SPA route change。默认不阻止官方事件；只有点击 SuperPoE2 注入控件时才阻止传播。按钮点击只发送 `realm + queryId + listingId + sourceUrl`，不能发送从 DOM 抄取的装备属性、价格或卖家数据。

注入要求：

- Adapter 在新增子树上增量扫描，并用稳定标记防止重复注入。
- 样式使用独立前缀或 Shadow DOM，避免污染官网；不注入完整扩展 Sidebar 和全局主题 CSS。
- 主进程返回成功后才显示已收藏；网络、验证或写盘失败必须恢复为可重试状态。
- 打开或刷新结果页时，由主进程按当前页面 listing ID 返回仓库来源状态，不把完整仓库数据暴露给远程页面。
- Adapter 无法识别新版 DOM 时停止注入并上报版本信号，不能猜测卡片或阻断官网操作。

禁止覆盖页面 `fetch`、XHR 或 WebSocket，禁止截取密码、账号表单、认证参数和私聊文本，禁止自动触发搜索、翻页、私聊或购买。

### 9.4 增强层级

稳定性优先级：

1. SuperPoE2 收藏/装备详情侧栏。
2. 用户主动右键或工具栏命令。
3. 官方 listing 卡片上的小型收藏图标。
4. 深度重排卡片或替换官方控件，不进入第一版。

本地侧栏打开时应缩小远程 view 的 bounds，为侧栏预留真实空间，不能让 React 面板覆盖原生 view。

## 10. Listing 可信化

DOM Adapter 只提取最小引用：

```ts
interface MarketDomListingRef {
  realm: 'cn' | 'global'
  queryId?: string
  listingId?: string
  resultUrl?: string
  visibleFingerprint?: string
}
```

收藏或打开结构化详情时：

1. 主进程校验 URL、query ID 和 listing ID。
2. 使用相同 realm session 调用官方 Trade Fetch。
3. runtime validator 将响应转换为共享 `TradeListingView`。
4. 统一装备仓库只接受 `TradeListingView` 转换后的 `LibraryItemSnapshot`，或明确标记 `unresolved` 的最小网页书签来源。

不能直接信任 DOM 中的价格、卖家和词缀。页面变化时，最坏结果应是无法解析，而不是收藏错误装备。

## 11. 统一装备仓库

### 11.1 主体与来源

仓库装备是主体，收藏只是来源。市场收藏、PoB 导入、装备界面收藏、手工录入和游戏内查价都进入同一条标准化与去重管线：

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

来源至少包含稳定幂等键和采集时间：

- `market-favorite`：`realm + listingId`，并保存 league、query、来源 URL、价格和可用状态快照。
- `pob-import`：`buildId + pobItemId`，保存 PoB 原始 item 文本。
- `equipment-favorite`：`buildId + equipmentSetId + itemId`，可附带槽位。
- `price-check`：查价 correlation ID、realm 和原始剪贴板文本引用。
- `manual`：用户显式创建记录。

同一装备可以有多个来源。取消网页收藏只移除对应的 `market-favorite` 来源；取消装备界面收藏只移除对应的 `equipment-favorite` 来源。只要仍有其他来源、目录、标签或备注，就不能删除仓库主体。listing 下架后保留装备和价格快照，仅把来源标记为 `unavailable`。

来源键用于幂等更新，装备 fingerprint 用于发现内容完全一致的重复项。不得使用价格、卖家、构筑 ID 或 Trade Stat ID 生成装备 fingerprint；跨语言或解析不完整时不得静默合并，只能提示用户确认。

### 11.2 词缀保存与查价共享

每条词缀同时保留原始证据、结构化观察值和可重新验证的查询解析：

```ts
interface LibraryModifier {
  id: string
  displayOrder: number
  group: 'enchant' | 'rune' | 'implicit' | 'explicit'
  sourceTags: TradeModifierSourceTag[]
  affixKind?: 'prefix' | 'suffix'
  original: {
    locale: 'zh-CN' | 'zh-TW' | 'en' | 'unknown'
    lines: string[]
    displayText: string
  }
  valueMode: 'numeric' | 'presence' | 'fixed-option'
  currentValues: number[]
  tierRanges: Array<{ min: number; max: number }>
  tradeResolutions: TradeStatResolutionSnapshot[]
}

interface TradeStatResolutionSnapshot {
  realm: 'cn' | 'global'
  queryStatId?: string
  baseStatId?: string
  optionId?: string
  candidateStatIds: string[]
  source: TradeStatSource
  catalogTemplate: string
  valueTransform: 'identity' | 'negate'
  resolvedBy: 'official-listing' | 'exact-text' | 'multi-line' | 'cross-realm-id' | 'user-confirmed'
  catalogFetchedAt: string
  catalogPayloadHash: string
  status: 'resolved' | 'ambiguous' | 'unresolved' | 'stale'
}
```

`status='resolved'` 时必须存在唯一 `queryStatId` 与 `baseStatId`；固定选项的 `queryStatId` 必须保留后缀，例如 `enchant.stat_2954116742|56666`，同时拆出 `optionId`。`ambiguous` 保存有限候选 ID，`unresolved` 的候选可为空。Stat ID 是 realm 限定的解析快照，不是仓库词缀或装备的永久主键。提交查价前必须用当前目标 realm catalog 重新验证；缺失、结构不兼容或 catalog 变化时从原始文本重算，`ambiguous`/`unresolved` 不得进入查询。

市场收藏优先使用官方 Fetch listing 提供的 Stat/hash 关系；PoB 导入、装备收藏和剪贴板查价统一调用共享 `TradeStatResolver`。不得为仓库、集市和 PriceCheck 各维护一套 matcher。

### 11.3 存储与视图

存储策略：

- `app.userData/library/equipment-library.v1.json`，并保留最近有效备份。
- 主进程读写，renderer 只调用类型化 CRUD/查询 IPC。
- 临时文件 + flush + 原子替换，保存前做 schema 校验，损坏文件隔离后从备份恢复。
- 来源、目录、备注、标签和单条原始文本均设置大小上限。
- 不保存 Cookie、密码、私聊、完整 HTML、DOM 节点或网页脚本状态。
- 第一版不引入 SQLite；数据量和价格历史需要索引时在 Repository 内部迁移，IPC 与 UI 模型保持不变。

第一版支持按来源、realm、赛季、装备槽、目录和标签过滤，支持备注、归档、打开来源页和用户主动刷新。第一版不做后台轮询或价格变化监控；后续的购买目标监控只消费官方 Live 新 listing 事件，并在用户尝试行动前重新校验 listing，不轮询价格。现有 `EquipmentItem` 继续作为构筑模型，仓库通过显式 Adapter 转换，市场 DTO 不得直接进入构筑模型。

## 12. IPC 边界

```ts
interface MarketBridge {
  activate(bounds: MarketBounds): Promise<MarketViewState>
  deactivate(): Promise<void>
  setBounds(bounds: MarketBounds): Promise<void>
  navigate(command: 'back' | 'forward' | 'reload' | 'stop' | 'home'): Promise<void>
  getState(): Promise<MarketViewState>
  login(): Promise<void>
  logout(): Promise<void>
  upsertLibrarySource(input: LibrarySourceInput): Promise<EquipmentLibraryEntry>
  removeLibrarySource(input: LibrarySourceKey): Promise<void>
  listLibrary(filter?: EquipmentLibraryFilter): Promise<EquipmentLibraryEntry[]>
  updateLibraryMetadata(input: LibraryMetadataPatch): Promise<EquipmentLibraryEntry>
  archiveLibraryEntry(id: string): Promise<void>
  onStateChanged(callback: (state: MarketViewState) => void): () => void
  onListingSelected(callback: (listing: TradeListingView) => void): () => void
  onLibraryChanged(callback: (event: EquipmentLibraryChangedEvent) => void): () => void
}
```

校验要求：

- 只接受 main window sender。
- bounds 是有限整数且位于当前 content bounds 内。
- navigation 只接受枚举，不接受 renderer URL。
- ID、筛选、备注和标签限制长度。
- 远程 preload 使用内部 channel，不能调用主窗口 bridge。
- 错误返回稳定错误码，不返回 Cookie、Header、绝对路径或原始 Electron 错误。

## 13. 导航与安全策略

- `will-navigate` 和 `will-redirect` 每次校验 profile allowlist。
- `setWindowOpenHandler` 对 allowlist 内认证弹窗创建受限子窗口并复用 session。
- 非 allowlist URL 拒绝内嵌；用户明确点击后可交给系统浏览器。
- 禁止 `file:`, `javascript:`, `data:` 和未知 scheme。
- 下载默认拒绝；未来支持官方导出时单独设计确认流程。
- 权限请求默认拒绝摄像头、麦克风、定位、通知、MIDI、USB、串口和剪贴板读取。
- 远程内容必须 `sandbox:true`、`nodeIntegration:false`、`contextIsolation:true`。
- Cookie 不进入 renderer、收藏、日志或崩溃报告。
- URL 日志移除 query、fragment 和认证参数。
- API 请求遵循官方限流；不能用网页请求绕过 Trade API 限流。
- 发布前确认服务条款对嵌入浏览、DOM 增强和 Trade API 的边界。

## 14. 失败与降级

| 故障 | 行为 |
| --- | --- |
| 官方网页加载失败 | 分类显示网络/证书/HTTP 错误，可重试或外部打开 |
| DOM Adapter 不匹配 | 显示增强不可用，官方网页继续工作 |
| listing 无法可信解析 | 不创建错误快照，可保存 `unresolved` 页面书签 |
| Session 过期 | 标记 expired，要求重新登录，PriceCheck 暂停认证请求 |
| 国服认证域名未知 | 阻止导航并记录脱敏诊断，不放宽成任意域名 |
| view 遮挡 modal/其他 Tab | 视为实现缺陷，deactivate 必须先隐藏 view |
| PriceCheck 限流 | 显示倒计时，不通过网页绕过 |
| 收藏文件损坏 | 保留损坏副本并从最近有效备份恢复，不静默清空 |

## 15. 建议目录

```text
electron/
  trade/
    realmProfiles.ts
    sessionManager.ts
    apiClient.ts
  market/
    marketViewManager.ts
    navigationPolicy.ts
    enhancementCoordinator.ts
    ipc.ts
    marketPreload.ts
    adapters/
      globalAdapter.ts
      cnAdapter.ts
  library/
    equipmentLibraryRepository.ts
    equipmentLibraryValidator.ts
    equipmentFingerprint.ts
    sourceIngestion.ts
  priceCheck/
    officialTradeProvider.ts
    coordinator.ts

src/components/market/
  MarketPanel.tsx
  MarketToolbar.tsx
  EquipmentLibraryPanel.tsx
  MarketListingDetail.tsx

src/trade/
  itemTextParser.ts
  tradeStatResolver.ts
  queryBuilder.ts

src/types/
  equipmentLibrary.ts
  trade.ts
```

`sessionManager` 和 `apiClient` 放在共享 `electron/trade/`，不能归属 `market/` 或 `priceCheck/`。纯函数 parser、resolver、query builder 放在 renderer 与主进程都可测试的共享领域目录，但官方 catalog 加载、网络和仓库写入仍由主进程协调。

## 16. 实施阶段

### Phase 0：真实站点验证

- 双区服首页、交易页、登录页和完整重定向链。
- 国服 QQ/WeGame 弹窗与必要 origin。
- realm partition 跨重启恢复。
- 同一 session 的 Search/Fetch 闭环。
- listing 卡片可稳定取得的 listing ID、query ID 和 URL。
- 官方 Fetch listing 的词缀 hash、source、固定选项和多行 Stat 映射。
- SPA 路由、无限列表和 DOM 更新方式。
- 服务条款与 User-Agent 要求。

完成标准：两个区服各完成一次网页登录；重启后状态恢复；国服登录态能直接支持 PriceCheck Search。

### Phase 1：安全浏览器

- `WebContentsView` manager。
- 顶部集市 Tab 和构筑中心入口。
- realm 切换、导航栏、加载和错误状态。
- allowlist、弹窗、权限和下载策略。
- bounds、modal、DPI 和 UI scale 生命周期。

完成标准：无页面增强时，双区服官方集市稳定浏览且不遮挡应用 UI。

### Phase 2：共享登录态

- 共享 `TradeSessionManager`。
- session 状态、重新登录和注销。
- PriceCheck `TradeApiClient` 复用 session。
- Cookie 不出主进程的安全测试。

完成标准：集市登录一次后 PriceCheck 无需再次登录，realm 切换和注销正确。

### Phase 3：页面收藏与统一装备仓库 MVP

- 双区服 DOM Adapter 提取最小 listing 引用。
- listing 卡片注入轻量收藏按钮，并实现 pending/active/error 状态回传。
- 官方 Fetch 解析为 `TradeListingView`。
- `EquipmentLibraryRepository`、来源联合类型、原子保存和损坏恢复。
- 市场收藏、PoB 导入、装备界面收藏和 PriceCheck 共用入库管线。
- 仓库侧栏、来源筛选、取消来源、来源页、备注、目录和标签。

完成标准：同一装备可保留多个来源；取消单一收藏来源不误删仓库主体；Adapter 失效时不会收藏错误装备，官网和 PriceCheck 仍正常。

### Phase 4：搜索收藏可用化

- 严格解析当前双区服官方搜索页并生成 canonical URL。
- 保存 leagueId、searchCode、查询能力等级和可用的 validated query snapshot。
- 使用项目内 modal 保存名称、备注、目录和是否开始监控，不再使用 `window.prompt()`。
- 补齐重复检测、用当前搜索更新、目录/卡片排序、删除和失效恢复。
- 与购买目标的连接生命周期原子协调；完整实现与验收见订阅设计 Phase O0。

完成标准：搜索收藏不再只是 URL 书签，可以稳定去重、更新、跨重启打开，并能作为 Live 购买目标的可信输入；搜索码失效时可自动恢复或明确引导人工更新。

### Phase 5：构筑联动

- 页面卡片收藏标记与仓库详情侧栏。
- 仓库装备通过 Adapter 转为 PoB Item。
- 与当前装备对比并调用 PoB 计算。

完成标准：候选价格、装备快照和构筑收益均能追溯到 realm、league、官方来源和计算条件。

## 17. 测试

单元测试：

- realm profile、URL allowlist 和 bounds validator。
- 严格搜索 URL parser、canonical URL、重复检测、query hash 和 code-only 降级。
- 搜索收藏 schema 迁移、目录/卡片排序、条件更新、搜索码恢复和原子回滚。
- session 状态机，测试数据不包含 Cookie value。
- equipment-library schema、来源幂等、迁移、原子保存和损坏恢复。
- 同一装备来自市场收藏、PoB 导入和装备界面收藏时保留多来源且不重复创建。
- 移除一个来源不误删其他来源、目录、标签和备注。
- Stat resolution 的 catalog hash 校验、stale 重算、固定 option ID 和跨 realm 降级。
- 双区服 adapter fixtures。
- listing reference 到 `TradeListingView` 的 validator。

Electron 集成测试：

- view 创建、显示、隐藏、resize 和销毁。
- Tab、modal、最小化和主窗口关闭时不残留 webContents。
- popup、redirect、permission 和 download policy。
- realm partition 隔离与跨重启恢复。
- Search POST body 观察的 URL/webContents/league/时间窗约束，不记录 Cookie、Header 或认证请求。
- 保存当前搜索、定位重复、用当前搜索更新和删除活动搜索的 IPC 闭环。
- 远程 preload 无法调用主窗口能力。

手工回归：

- 1024x720、1440x960、高 DPI 和所有 UI scale。
- 双区服登录、注销、切换和重启。
- 搜索、分页、详情、私聊按钮和返回导航。
- 双区服有效搜索收藏、非搜索页拒绝、重复定位、条件更新、目录拖拽和失效搜索恢复。
- 页面增强启用、失效和关闭。
- 收藏后刷新页面、按钮状态恢复、listing 下架和赛季切换。
- 集市登录后直接执行一次 PriceCheck Search + Fetch。

## 18. 需要确认的产品决策

建议默认值：

1. **入口**：集市同时出现在编辑器顶部 Tab 和构筑中心；以后再上移为应用级固定导航。
2. **仓库语义**：装备仓库是唯一主体；市场收藏、PoB 导入、装备界面收藏和查价记录只是来源。价格是市场来源的时间点快照，不做后台监控；由用户主动刷新。
3. **注入深度**：第一版在 listing 卡片增加收藏图标和右键操作，详细界面放 SuperPoE2 仓库侧栏，不重排官网。
4. **登录**：国服无 session 时要求登录；国际服允许匿名浏览和查价，同时提供可选登录。
5. **外部链接**：非官方交易/认证域名全部交给系统浏览器，不允许应用内任意上网。
6. **卖家数据**：不持久化账号名和私聊文本，只保存价格、在线状态快照和官方来源。
