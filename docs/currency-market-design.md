# SuperPoE2 通货行情详细设计

> 状态：设计确认中，尚未实施
> 更新日期：2026-08-01
> 适用项目：`D:\sources\superpoe`
> 所属模块：全局交易中心
> 数据来源：国服 `poecurrency.top`，国际服 `poe2scout.com`
> 关联设计：[marketplace-browser-design.md](./marketplace-browser-design.md)、[market-subscription-design.md](./market-subscription-design.md)、[price-check-design.md](./price-check-design.md)

## 1. 产品结论

通货行情作为交易中心的第三个一级 Tab，位于“集市与仓库”和“实时监控”之间：

```text
集市与仓库 | 通货行情 | 实时监控
```

它是一个只读的批量行情查询页，不属于独立 PriceCheck 模块，也不承担购买、收藏或监控行为。页面一次拉取当前区服的批量数据，在本地完成搜索、分类、排序、计价单位切换和行选择。

区服只读取项目现有 `AppSettings.defaultRealm`：

| 默认服务器 | 数据源 | 赛季处理 |
| --- | --- | --- |
| 腾讯国服 | `https://poecurrency.top/api/summary?version=2` | 数据源当前汇总，不由用户选择 |
| 国际服 | `https://api.poe2scout.com/poe2/Leagues` + 当前赛季接口 | 自动选择 `IsCurrent: true`，不硬编码赛季短名 |

页面不再提供第二套服务器或赛季设置。服务器改变后重新载入对应数据；国际服当前赛季从数据源自动发现并显示。

## 2. 产品边界

### 2.1 包含

- 批量查看当前区服的通货、碎片、符文及数据源支持的其他可交易类别。
- 按名称搜索、按类别过滤并按价格等字段排序。
- 在崇高石和神圣石计价之间切换。
- 展示数据来源、来源赛季、更新时间、缓存状态和数据质量。
- 查看单个通货的来源特有明细。
- 网络失败时读取最近一次成功缓存，并明确标注缓存年龄。
- 手动刷新；页面首次打开或区服变化时按缓存策略自动刷新。

### 2.2 不包含

- 收藏通货、保存列表或自定义分组。
- 价格监控、阈值提醒、系统通知或游戏浮层。
- 购买、私聊、打开某条卖单或自动交易。
- 跨国服与国际服比较、合并或推断套利机会。
- 将第三方行情冒充官方实时成交价。
- 从该页面修改全局服务器或手工维护赛季。
- 第一版绘制历史 K 线；当前接口的历史维度并不对称。

这些边界让页面保持“打开即可查”的定位。未来价格监控如要实施，应单独设计订阅模型，不能给当前表格临时增加后台轮询。

## 3. 数据源契约

### 3.1 国服 poecurrency.top

首选批量接口：

```text
GET https://poecurrency.top/api/summary?version=2
```

返回数据已经按类别分组，物品常见字段包括：

```ts
interface PoecurrencySummaryItem {
  item_name: string
  engname?: string
  item_icon?: string
  buy_avg?: number
  sell_avg?: number
  buy_avg_yesterday?: number
  sell_avg_yesterday?: number
  buy_avg_ratio?: number | null
  sell_avg_ratio?: number | null
  latest_buy1?: number
  latest_sell1?: number
  latest_datetime?: string
  prev_buy1?: number
  prev_buy1_datetime?: string
  buy_avg_12h?: number
  sell_avg_12h?: number
  buy_avg_24h?: number
  sell_avg_24h?: number
  currency_unit?: 'e' | 'd' | 'c' | string
  error?: boolean
  error_info?: string
  anomaly_count?: number
}
```

设计约束：

- 保存来源原始单位和数值，再计算崇高石归一价。
- `0`、非有限数值和负数视为缺失，不显示为免费。
- `error: true`、异常数大于零或缺少有效报价时降低质量状态。
- 第一版只使用 summary 数据，不依赖 token，也不逐项调用 `db/price` 修复。
- 不能在前端直接请求第三方接口；由 Electron 主进程统一请求、校验和缓存。

### 3.2 国际服 poe2scout

赛季发现：

```text
GET https://api.poe2scout.com/poe2/Leagues
```

选择 `IsCurrent === true` 的 PoE2 赛季，并使用其 `ShortName` 请求：

```text
GET https://api.poe2scout.com/poe2/Leagues/{shortName}/ReferenceCurrencies
GET https://api.poe2scout.com/poe2/Leagues/{shortName}/SnapshotPairs
```

League 中的 `DivinePrice`、`ChaosDivinePrice` 和 `BaseCurrencyApiId` 作为该次快照的换算元数据。Snapshot pair 可提供双方通货、图标、类别以及：

```ts
interface Poe2ScoutPairObservation {
  relativePrice: number
  valueTraded?: number
  volumeTraded?: number
  stockValue?: number
  highestStock?: number
  // 实际 DTO 还包含 base/quote currency 引用
}
```

同一通货存在多组观察时，第一版采用确定性选择：

1. 仅保留可以相对基准通货换算且价格为正的观察。
2. `ValueTraded` 较高者优先。
3. 相同成交价值时选择价格较高者，保证排序稳定。
4. 记录被选中的报价对，供详情区解释来源。

不得硬编码当前短名，例如 `runes`。找不到唯一当前赛季时请求失败并保留旧缓存，不能猜测选择列表第一项。

### 3.3 数据语义

两家服务都是第三方行情汇总，不是 SuperPoE2 采集的实时成交记录。界面统一使用“行情”“参考价”和“数据更新时间”，不使用“官方价格”“实时成交价”。

来源字段不对称：

| 能力 | 国服 | 国际服 |
| --- | --- | --- |
| 当前参考价 | 有 | 有 |
| 崇高石归一价 | 可计算 | 可计算 |
| 神圣石折算 | 可计算 | 可计算 |
| 买入/卖出方向 | 有 | 不等价 |
| 昨日、12h、24h | 有 | 第一版无同口径字段 |
| 涨跌百分比 | 有 | 第一版不推导 |
| 成交量/成交价值 | 无同口径字段 | 有 |
| 库存/最高库存 | 无同口径字段 | 有 |
| 异常标记 | 有 | 由完整性和成交量推导 |

因此主表只放稳定共有字段，来源特有指标进入详情区。

## 4. 归一化领域模型

第三方响应只存在于主进程 Adapter 内，renderer 只接收经过校验的统一 DTO：

```ts
type CurrencyMarketSource = 'poecurrency' | 'poe2scout'
type CurrencyMarketQuality = 'good' | 'thin' | 'anomalous' | 'missing'
type CurrencyQuoteUnit = 'exalted' | 'divine'

interface CurrencyMarketSnapshot {
  schemaVersion: 1
  realm: 'cn' | 'global'
  source: CurrencyMarketSource
  sourceLabel: string
  sourceLeague?: string
  fetchedAt: string
  sourceUpdatedAt?: string
  expiresAt: string
  divineInExalted?: number
  items: CurrencyMarketItem[]
}

interface CurrencyMarketItem {
  id: string                 // source + 稳定 API id；国服无 id 时使用规范化英文名
  name: string               // 当前 UI 首选名称
  englishName?: string
  iconUrl?: string
  categoryId: string
  categoryLabel: string
  priceExalted?: number
  priceDivine?: number
  originalQuote?: {
    value: number
    unit: string
    label: string
  }
  quality: CurrencyMarketQuality
  qualityReason?: string
  updatedAt?: string
  sourceDetails: PoecurrencyDetails | Poe2ScoutDetails
}

interface PoecurrencyDetails {
  kind: 'poecurrency'
  latestBuy?: number
  latestSell?: number
  averageBuy?: number
  averageSell?: number
  average12hBuy?: number
  average12hSell?: number
  average24hBuy?: number
  average24hSell?: number
  previousBuy?: number
  buyChangePercent?: number
  sellChangePercent?: number
  anomalyCount?: number
  errorInfo?: string
}

interface Poe2ScoutDetails {
  kind: 'poe2scout'
  pairLabel: string
  valueTraded?: number
  volumeTraded?: number
  stockValue?: number
  highestStock?: number
}
```

价格换算规则：

```text
priceDivine = priceExalted / divineInExalted
```

- `divineInExalted` 必须来自相同区服、相同来源、相同快照。
- 换算比例缺失或非正数时不展示神圣石价格，并禁用神圣石计价切换。
- 计算保留完整精度，UI 最后格式化；禁止用已舍入显示值继续换算。
- 原始报价与归一价发生明显冲突时保留原始值并标记异常，不静默修正。

## 5. 信息架构与布局

### 5.1 交易中心入口

`MarketShell` 的工作区类型扩展为：

```ts
type MarketWorkspaceView = 'market' | 'currency' | 'monitoring'
```

顶部标题副文案调整为：

```text
集市、装备仓库、通货行情与实时监控
```

“通货行情”使用 `Coins` 图标。普通进入交易中心时保留上次使用的 Tab；从机会浮层进入仍固定打开实时监控。

### 5.2 桌面布局

页面采用无卡片的密集工作区：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 搜索通货  [全部分类 v]  [崇高石|神圣石]   腾讯服 · poecurrency  ↻ │
│                                      更新于 15:00 · 缓存/最新状态  │
├──────────────────────────────────────────────┬───────────────────────┤
│ 通货             分类       当前价格  状态   │ 选中通货详情          │
│ [图] 神圣石      通货       618.0 E   正常   │ 神圣石                │
│ [图] 完美工匠石  通货         9.4 E   正常   │ 618.0 崇高石          │
│ ...                                          │ 来源特有指标           │
│                                              │ 原始报价/更新时间      │
└──────────────────────────────────────────────┴───────────────────────┘
```

- 工具栏固定在内容顶部，表头 sticky。
- 宽度 `>= 1120px`：表格和右侧详情约 `minmax(620px, 1fr) 320px`。
- 宽度 `< 1120px`：隐藏固定详情栏，点击行后在表格下方显示同一详情内容。
- 宽度 `< 760px`：类别与计价单位换行；表格保留通货、当前价格、状态，分类并入名称副行。
- 表格行高固定约 46px，图标固定 32px；加载、图标缺失和长名称不能改变行高。
- 详情栏是工作区分栏，不使用嵌套卡片。

### 5.3 工具栏

从左到右：

1. 搜索框：同时匹配中文名、英文名；输入即时本地过滤。
2. 分类菜单：默认“全部分类”，选项来自当前快照，显示分类条目数。
3. 计价 segmented control：`崇高石 / 神圣石`，仅改变显示和排序单位。
4. 当前区服 badge：只读，提示“跟随全局设置”。
5. 来源与赛季：如 `poe2scout · Runes of Aldur`。
6. 更新时间：优先来源更新时间，否则显示本地拉取时间。
7. 刷新图标按钮：刷新时原地旋转并禁用，表格继续显示旧数据。

不放“设置”“收藏”“监控”“购买”按钮。数据源不是用户可切换选项，来源由区服确定。

### 5.4 主表

稳定列定义：

| 列 | 内容 | 默认行为 |
| --- | --- | --- |
| 通货 | 32px 图标、名称、可选英文副名 | 名称可排序 |
| 分类 | 来源分类映射后的显示名 | 可过滤、可排序 |
| 当前价格 | 当前计价单位下的参考价，附单位图标/缩写 | 默认降序 |
| 神圣石折算 | 固定显示神圣石等值；当前已选择神圣石时改为崇高石折算 | 数值排序 |
| 状态 | 正常、样本偏少、异常、暂无价格 | 质量优先级排序 |
| 更新时间 | 行级更新时间；缺失时显示快照时间 | 时间排序 |

显示规则：

- `< 0.01` 保留最多 4 位有效小数；`0.01-9.99` 最多 2 位；`>= 10` 最多 1 位。
- 缺失价格显示 `--`，不参与价格排序的有效值区间。
- 当前计价单位列使用较强字重；折算列弱化，避免出现两个“主价格”。
- 默认按有效价格降序，其后为缺失价格；排序箭头只出现在当前排序列。
- 点击整行选择详情；键盘上下键移动选择，Enter 在窄布局展开详情。
- 切换搜索或分类后，若选中项仍可见则保留，否则选择过滤结果第一项。

### 5.5 详情区

公共头部：

- 图标、中文名、英文名、分类。
- 当前参考价、另一计价单位折算。
- 数据质量及具体原因。
- 数据源、来源赛季、原始报价、行更新时间。

国服详情展示：

```text
最新买入 / 最新卖出
当前买入均价 / 卖出均价
12 小时买入 / 卖出均价
24 小时买入 / 卖出均价
昨日买入 / 卖出均价
买入涨跌 / 卖出涨跌
前次买入及时间
异常次数 / 来源错误说明
```

没有值的单个指标显示 `--`；整组没有值时隐藏该组，避免空面板。涨跌使用符号、文本和颜色共同表达，不能只依赖红绿颜色。

国际服详情展示：

```text
采用报价对
成交价值 ValueTraded
成交数量 VolumeTraded
当前库存 StockValue
最高库存 HighestStock
当前基准通货和神圣石汇率
```

指标名称在中文 UI 中使用中文，tooltip 可标明来源英文原字段。详情不绘制伪历史曲线，也不根据单个快照计算涨跌。

## 6. 数据质量与状态

### 6.1 行级状态

| 状态 | 条件示例 | UI |
| --- | --- | --- |
| `good` | 有效正价格，来源未标异常，国际服交易数据充分 | “正常”低强调文本 |
| `thin` | 国际服选中 pair 的成交量/价值偏低，或关键辅助字段缺失 | “样本偏少”琥珀色状态 |
| `anomalous` | 国服 `error`、异常数、无效价差或换算冲突 | “异常”并在详情解释 |
| `missing` | 无可用正价格 | “暂无价格”，价格为 `--` |

国际服 `thin` 的具体阈值在实现前用真实快照分布确定并写入常量测试，不能拍脑袋固定一个绝对值。阈值只能改变提示，不能修改来源价格。

### 6.2 页面级状态

- 首次加载且无缓存：显示固定行高的 skeleton 表格和“正在读取行情”。
- 有缓存并后台刷新：继续显示缓存，更新时间旁显示“正在刷新”。
- 缓存未过期：显示“缓存”，不强制联网。
- 缓存过期：显示“缓存已过期”，自动尝试刷新；失败仍保留旧表。
- 刷新失败且有缓存：顶部显示非阻塞错误条，包含失败原因与“重试”。
- 刷新失败且无缓存：显示空状态、数据源名称和重试按钮。
- 搜索无结果：显示“没有匹配的通货”，保留筛选工具栏。
- 当前赛季不可发现：国际服显示“无法确定当前赛季”，不得使用旧赛季新抓取数据。

## 7. 请求、缓存与安全

### 7.1 主进程职责

新增独立目录，避免和 PriceCheck 查询实现耦合：

```text
electron/currencyMarket/
  currencyMarketService.ts
  currencyMarketCache.ts
  adapters/
    poecurrencyAdapter.ts
    poe2ScoutAdapter.ts

src/components/market/currency/
  CurrencyMarketWorkspace.tsx
  CurrencyMarketToolbar.tsx
  CurrencyMarketTable.tsx
  CurrencyMarketDetails.tsx

src/types/currencyMarket.ts
```

PriceCheck 可以在未来只读消费同一份归一化汇率快照，但不能依赖通货行情页面组件，也不能把第三方汇率当作装备估价的唯一事实来源。

主进程负责：

- 固定 HTTPS host 与路径 allowlist，不接受 renderer 传入 URL。
- 超时、响应大小上限、JSON schema 校验和数值边界校验。
- 国际服三请求的同轮次组合；任何关键请求失败都不写入半份新缓存。
- 原始响应到统一 DTO 的适配、换算和质量标记。
- 原子写入最近成功快照。
- 向 renderer 暴露窄 IPC：`getSnapshot(realm, forceRefresh?)`。

### 7.2 缓存策略

- 按 `realm + source` 隔离缓存，`schemaVersion: 1`。
- 建议内存 TTL 10 分钟，磁盘 stale-while-revalidate 上限 24 小时。
- 首次进入页面：10 分钟内缓存直接返回；较旧缓存立即返回并后台刷新。
- 手动刷新绕过新鲜度判断，但仍复用进行中的同区服请求，避免并发重复抓取。
- 新响应通过完整校验后用临时文件 + rename 原子替换。
- 缓存损坏、版本不兼容或区服不符时丢弃该文件，不影响另一地区缓存。
- 第三方响应和错误日志不得包含 Cookie；这些公开接口不复用官方 Trade 登录会话。

默认 TTL 应在实际观察两家更新时间后确认。如果 poecurrency 的数据小时级更新，频繁刷新不会带来更实时的结果，只会增加服务压力。

## 8. 交互与可访问性

- 表格采用真实语义或等价 ARIA grid，排序按钮可由键盘操作。
- 状态不能只依赖颜色；图标、文字和 tooltip 共同解释。
- 图标加载失败显示固定尺寸的 `Coins` 占位，不造成布局跳动。
- 搜索框清除使用 `X` 图标按钮，并提供明确 aria-label。
- 刷新按钮使用 `RefreshCw`，tooltip 显示“刷新通货行情”。
- 长名称单行省略，完整名称通过 title/tooltip 可见。
- 数字使用等宽数字特性，排序或刷新时列宽保持稳定。
- 不自动抢焦点；返回该 Tab 时恢复搜索、分类、排序、计价单位和选中行的会话状态。

## 9. 实施阶段

### C0：契约固化

- 保存两家真实响应 fixture，但剥离无关大字段。
- 为赛季选择、pair 选择、价格换算、异常值和缺失字段建立单元测试。
- 确认 poecurrency 类别结构与 poe2scout 当前 DTO 字段大小写。
- 基于国际服快照分布确定 `thin` 提示阈值。

### C1：主进程数据层

- 实现两个 Adapter、归一模型、超时、限流与缓存。
- 增加窄化 IPC 和 preload 类型。
- 验证离线、损坏缓存、来源 5xx、超时和当前赛季缺失。

### C2：交易中心界面

- 增加“通货行情”Tab 与 workspace。
- 完成工具栏、响应式表格、详情区和所有状态。
- 保持切换 Tab 时集市 `WebContentsView` 正确挂起/恢复，不能遮盖通货页。

### C3：真实数据验收

- 国服与国际服各完成一次在线、缓存、断网和手动刷新验证。
- 核对神圣石、崇高石等基准通货的换算自洽。
- 检查长名称、缺图、无价格、异常数据、窄窗口和高 DPI。
- 运行构建、相关单元测试并截图检查桌面/窄窗口布局。

## 10. 验收标准

1. 当前默认服务器为国服时只请求 poecurrency；国际服时只请求 poe2scout，并自动识别当前赛季。
2. 用户不需要配置赛季、token 或第二套服务器。
3. 页面可以在单次批量下载后即时搜索、分类、排序和切换计价单位。
4. 主表在两个区服保持同一组稳定列，不出现半数列长期为空。
5. 国服买卖/时段数据和国际服成交/库存数据在选中项详情中得到完整表达。
6. 每个价格都能看到区服、来源、来源赛季（如适用）和更新时间。
7. 网络失败时不清空已有结果，过期缓存有明确标识，手动重试可用。
8. 无效、异常和低样本数据不会显示成无警告的精确正常价格。
9. 页面没有收藏、监控、购买和私聊行为，也不启动后台价格轮询。
10. 切换交易中心 Tab 不影响官方集市登录态、装备仓库或实时监控连接。

## 11. 已确认的产品决策

- 功能名称：`通货行情`。
- 所属位置：全局交易中心第三个能力页，不进入独立 PriceCheck 目录。
- 数据源：国服 `poecurrency.top`，国际服 `poe2scout.com`。
- 区服：跟随全局“构筑默认值 -> 默认服务器”。
- 赛季：不进入全局设置；国际服由 poe2scout 当前赛季自动发现。
- 交互：只读查询，不做收藏、监控和交易动作。
- 页面结构：密集表格 + 选中项详情，桌面右栏、窄窗口下沉。
- 默认计价：崇高石；可切换神圣石。
- 默认排序：有效参考价降序。

## 12. 实施前仍需确认

只有一个产品选择会影响第一版范围：是否把“国际服低成交量/低库存”的数据质量阈值作为首发功能。建议保留该提示，但在 C0 用真实数据分布确定阈值；如果无法得到稳定规则，则第一版只显示成交指标，不给出“样本偏少”的判断。
