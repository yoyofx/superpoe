# 查价词缀到交易请求的处理链路

> 状态：设计与实现对照文档
> 更新日期：2026-08-08
> 适用项目：`D:\sources\superpoe`
> 外部参考：`D:\sources\Poe2PriceGui`
> 关联设计：[price-check-design.md](./price-check-design.md)

本文记录两套实现的实际行为：一套是 `Poe2PriceGui` 内嵌的 Xiletrade 解析器，另一套是 SuperPoE 当前使用的 PoB2 Item Bridge + 官方 Trade Provider。目的不是复制 Xiletrade，而是明确一条词缀从装备文本到最终官方交易查询的完整边界，避免把显示文本、计算语义和交易 stat ID 混成同一个字段。

## 1. 最终目标

一次查价应当产生以下中间结果：

```text
游戏复制文本
  -> ParsedTradeItem（名称、底材、稀有度、属性、词缀、来源证据）
  -> ResolvedTradeItem（按 realm 解析的 stat ID、option、数值模式）
  -> TradeSearchForm（用户选择的词缀和 Min/Max）
  -> trade2 Search JSON
  -> search id
  -> Fetch listing ids / listing details
```

其中：

- 原始文本和结构化词缀是装备观察结果；
- PoB2 Lua 的英文 mod 语义是 SuperPoE 的 canonical 来源；
- 官方 `/data/stats` 是当前区服的可查询能力目录和校验来源；
- `stat ID` 只表示本次区服/版本下的查询方式，不能作为装备永久身份；
- 不确定或有歧义的词缀不能静默提交为一个看似确定的 ID。

## 2. Poe2PriceGui（Xiletrade）实际流程

代码位置：`D:\sources\Poe2PriceGui\Xiletrade`，接入入口为 `Services/XiletradePriceService.cs` 和 `ViewModels/MainViewModel.cs`。

### 2.1 输入标准化与物品识别

`InfoDescription` 先做以下处理：

1. 统一换行符；
2. 去除空的 `()`；
3. 展开 `[中文|English]` 形式的双语文本；
4. 去掉末尾交易价/`bo` 行；
5. 按 `--------` 分段；
6. 依据当前 `Resources` 语言判断第一行是否为物品类别。

`DataManagerService.TryInit(2)` 强制使用 PoE2 数据模式。它从 `Xiletrade/Data/Lang/<culture>/` 加载：

- `FiltersTwo.json`：词缀过滤器和交易 stat ID；
- `ParsingRules.json`：文本层/变体规则；
- `BasesTwo.json`、`WordsTwo.json`、`ModsTwo.json`、`Gems.json` 等名称、底材和辅助数据；
- `FiltersTwo.json` 的英文版本还用于把中文词缀翻译为国际服查询文本。

### 2.2 `ItemData` 建立物品和词缀列表

`ItemData` 先通过 `ItemHeader`、`ItemFlag` 识别：

- 物品名称和底材（含英文/网关语言）；
- 普通、魔法、稀有、传奇；
- 武器、护甲、珠宝、咒符等物品类型；
- 已鉴定、腐化、裂界/制作/亵渎等状态；
- 物品等级、品质、护甲/闪避/能量护盾、DPS 等结构化属性。

`GetModList` 遍历物品段落。每一个高级词缀标题（例如 `{ 前缀属性 ... }`）先由 `ModDescription` 解析为 `AffixFlag`，识别：

- `implicit`、腐化隐含、附魔/符文；
- 前缀、后缀、制作、裂痕、亵渎；
- 传奇固定词缀；
- tier、阶级和原始标签。

随后为每一行创建 `ItemModifier`：

1. `ParseTierValues` 提取当前值和括号中的 tier 范围，并从查询文本中移除 `(min-max)`；
2. `ModInfoParse` 应用 `ParsingRules.json` 的层级规则，处理武器/护甲局部词缀、负值、跨行词缀和需要根据物品类型选择的变体；
3. 规则无法命中时使用 Levenshtein 模糊匹配；
4. `ModFilter` 在当前语言的 `FilterData.Result` 中按规范化文本查找候选条目，必要时处理多行词缀、传奇选项和特殊 fallback；
5. 命中后得到 `FilterResultEntrie.ID`、过滤器类型、可选 option 和当前值范围；未命中的行不会加入可查价 `ModList`。

这一步的重点是：中文显示行并不是最终查询条件，必须先归一化为过滤器模板（数字位置变成 `#`），并结合词缀来源和物品类型消除同文不同 ID 的歧义。

### 2.3 `FormViewModel` 暴露给用户的查价条件

`FormViewModel` 把 `ItemData.ModList` 转为 `ModLineViewModel`。每条行包含：

- `Mod`：当前语言显示文本；
- `ModEn`：英文过滤器文本；
- `Affix` / `AffixIndex`：可选的候选 stat；
- `TierKind`、`Tier`、`TierMin`、`TierMax`；
- `Min`、`Max`：实际提交的范围；
- `Selected`：是否作为查询条件；
- `Option` / `OptionID`：固定选项词缀。

默认选中策略由 `ModLineViewModel.GetModSelection` 决定，会按稀有度、隐含词缀、生命/抗性/能量护盾、武器 DPS 相关标签等配置自动勾选。它只是 UI 初始状态，用户仍可取消或调整。

### 2.4 选中词缀如何进入请求

`MainViewModel.ExecuteOverlaySearchAsync` 从 `Form.ModList` 收集：

```text
(ModText, AffixType, Min, Max)
```

并执行以下过滤：

- 只提交 `Selected == true` 且有 `TierKind` 的词缀；
- 过滤 `TierKind` 为空的符文属性/固有技能行，因为它们通常不是交易 API 的可索引 stat；
- 国际服优先使用 `ModEn`，国服使用当前网关语言文本；
- 传奇按名称搜索，稀有/魔法/普通按底材类型搜索；
- 品质、物等、护甲、闪避、能量护盾等进入结构化 filter，而不是普通 stat 行；
- 已腐化、已鉴定等选项由独立的三态条件转换。

### 2.5 `PoeTradeService` 的 stat ID 匹配

服务先请求对应区服的 `/data/stats`，将嵌套的结果展平成：

```text
(text, id, category, options[])
```

每一条选中的词缀按以下顺序匹配：

1. 去掉 tier 括号；
2. 把数字归一化为 `#`；
3. 先按完整模板匹配；
4. 按 `implicit`、`explicit`、`crafted` 等来源范围缩小候选；
5. 处理带 option 的固定词缀，形成 `baseStatId|optionId`；
6. 解析当前值、用户 Min/Max 或精确查价模式；
7. 必要时使用 Levenshtein 距离处理轻微文本差异；
8. 仍有多个候选时保留候选列表，不应伪装成唯一 ID。

数值范围遵循两个规则：

- 普通数值词缀：`value: { min, max }`；
- 固定 option 词缀：只发送带 `|optionId` 的 stat，不发送数值范围；
- 负向词缀：先把数值变换记录下来，再交换/取反 min/max 的方向。

### 2.6 最终 Search JSON

典型请求结构如下（字段会随物品和用户选项变化）：

```json
{
  "query": {
    "status": { "option": "securable" },
    "name": "传奇物品名称",
    "type": "底材名称",
    "stats": [
      {
        "type": "and",
        "filters": [
          { "id": "explicit.stat_xxx", "value": { "min": 100, "max": 120 } },
          { "id": "implicit.stat_yyy" }
        ]
      }
    ],
    "filters": {
      "misc_filters": { "filters": { "ilvl": { "min": 80 } } },
      "type_filters": { "filters": { "rarity": { "option": "rare" } } }
    }
  },
  "sort": { "price": "asc" }
}
```

然后：

1. `POST /api/trade2/search/<league>` 获取 `id` 和结果 ID 列表；
2. 按批次调用 `GET /api/trade2/fetch/<id>?query=...` 获取 listing；
3. 将价格、卖家状态、物品详情和原始 listing 引用转换成 UI 模型。

国服和国际服只切换官方 API 根地址、语言/名称和默认上架状态，不能混用另一服的 stat catalog 或 session。

## 3. SuperPoE 当前实现对照

当前 SuperPoE 已经采用更适合长期维护的分层：

```text
剪贴板 / PoB item raw
  -> electron/pobItemBridge.ts
  -> LuaJIT sidecar normalizeItem
  -> CanonicalItemView.modifiers
       (group, sourceTags, tradeStatIds, tradeValue, localized)
  -> electron/tradeService.ts
  -> TradeReferenceDataCache（官方 /data/stats）
  -> TradeStatResolver
  -> buildTradeQuery
  -> OfficialTradeProvider.search
```

### 3.1 解析和规范化

`PobItemBridge.normalize` 不使用前端正则重建物品语义，而是调用 PoB Lua 的 `Item` 解析。Lua 负责：

- 物品底材/物品类型和基础属性；
- `enchant`、`rune`、`implicit`、`explicit` 分组；
- 每条 mod 的语义、作用域、受益对象、wrapper 和关键字；
- PoB 的 Trade Hash / stat descriptor；
- 当前数值和固定选项。

返回的 `CanonicalItemView.modifiers` 已包含 `tradeStatIds` 和 `tradeValue`。这使装备展示、计算和查价共享同一个解析结果，避免另外维护 Xiletrade 式的正则词缀表。

### 3.2 官方 catalog 解析

`TradeReferenceDataCache` 按 `cn/global` 缓存官方 `/data/stats`，保存抓取时间和 payload hash。`TradeStatResolver`：

1. 按目标 realm 选择本地化显示文本；
2. 把数字归一化为 `#`；
3. 先做官方模板精确匹配；
4. 根据 `sourceTags`/group 限定 `explicit`、`implicit`、`enchant`、`rune` 等 scope；
5. 处理 `entry.option.options`，生成 `statId|optionId`；
6. 保存 `resolved / ambiguous / unresolved` 状态、候选 ID、catalog hash 和时间。

这一步是“官方 catalog 校验/补全”，不是重新解析 PoB 的装备语义。

### 3.3 查询构建

`buildTradeQuery` 只把用户选择的、已解析的词缀加入 `stats`：

- numeric 使用用户 `min/max`，没有用户范围时使用装备当前值作为 `min`；
- presence 不发送数值；
- fixed-option 只发送 option stat ID；
- 负值通过 `valueTransform: "negate"` 转换范围；
- 传奇按名称，并同时保留底材；
- 非传奇按底材/官方分类；
- 物等使用 `misc_filters.ilvl`；
- 价格排序由 `sort.price = asc`；
- Search 返回 400 且存在底材时，Provider 才回退到只按底材的查询，并把未解析词缀数量返回给 UI。

IPC 只把已验证的查询条件传入主进程。session、缓存路径和原始 Cookie 不进入 renderer。

## 4. 两套实现的关键差异

| 能力 | Poe2PriceGui / Xiletrade | SuperPoE 当前设计 |
| --- | --- | --- |
| 词缀语义来源 | 本地 `FiltersTwo.json`、`ParsingRules.json` 和 C# 规则 | PoB2 Lua Item + Trade Hash |
| 中文显示解析 | 本地语言过滤器先解析，再拿英文文本 | Lua 先生成英文 canonical，官方 catalog 按 realm 校验 |
| 模糊匹配 | 有 Levenshtein fallback | 当前以精确模板和 scope 匹配为主，歧义保留候选 |
| 词缀 ID | `FilterResultEntrie.ID`，直接进入 `ItemFilter` | `tradeStatIds`/运行时 resolution，不作为装备身份 |
| tier 范围 | `ItemModifier.ParseTierValues` 提取括号范围 | PoB canonical current value；用户在查价窗口设置范围 |
| 符文/固有属性 | UI 层显式过滤部分 `TierKind` 为空行 | 由 modifier group/sourceTags 和可查询 catalog 决定 |
| 区服数据 | 本地语言目录与网关配置 | 每个 realm 独立官方 `/data/stats`、items、filters、session |
| 失败策略 | 未匹配词缀可能从 ModList 消失或标记错误 | unresolved/ambiguous 可见，必要时由用户确认或回退底材查询 |

## 5. SuperPoE 的实现边界和后续要求

### 必须保持

1. `CanonicalEquipmentItem`/`CanonicalItemView` 是装备事实来源；查价不能创建第二份装备模型。
2. PoB Lua 是 mod 语义和 Trade Hash 的唯一来源；TypeScript 只做请求组合、范围变换和校验。
3. 官方 `/data/stats` 只做当前区服能力目录和可用性验证；缓存可删除、可重建，并记录 payload hash。
4. 每个词缀保留原始行、localized 行、group/sourceTags、当前值、候选 stat ID 和解析状态，便于诊断和用户确认。
5. 未解析或有歧义的词缀不能默认提交一个猜测 ID；UI 应明确显示“未解析/多个候选”。
6. 查询生成必须区分 numeric、presence、fixed-option，并统一处理负值范围。
7. Search、Fetch、listing 归一化和仓库入库继续走同一个 OfficialTradeProvider；不能由装备页、市场页、查价浮层各自实现一份映射。

### 需要补强的测试

- 中文、繁体中文和英文同一词缀的 realm catalog 匹配；
- explicit/implicit/enchant/rune 同文本但不同 scope；
- 传奇固定 option、普通 numeric、无数值 presence；
- 负向词缀的 min/max 取反和顺序交换；
- 多 stat 候选、ambiguous、unresolved 时不提交错误查询；
- 稀有按底材、传奇按名称+底材；
- 国服 `securable` 与国际服 `online/available` 状态；
- Search 400 后只按底材回退，并在 UI 标记未参与查询的词缀；
- 官方 catalog 过期、请求失败和缓存 hash 变化后的重新解析；
- 原始文本、canonical item 和 trade query 的日志脱敏。

## 6. 结论

Poe2PriceGui 的查价流程可以作为行为参考，尤其是“词缀来源分组、数字模板化、option、数值范围和结构化过滤器”的概念。但 SuperPoE 不应把 Xiletrade 的 C# 词缀表或本地 `FiltersTwo.json` 变成第二套事实来源。当前应继续让 PoB2 Lua 产生 canonical mod/Trade Hash，使用官方 catalog 验证目标区服能否查询，再由统一 query builder 生成最终 JSON；只有在 Lua 无法解析、官方 catalog 发生歧义时，才把候选和证据交给用户，而不是用静默正则猜测。
