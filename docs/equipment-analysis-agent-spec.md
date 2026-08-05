# 装备分析 Agent 语义与实现规范

> 状态：设计草案
> 最后更新：2026-08-03
> 适用范围：装备详情、装备对比、市场候选评估、游戏内复制物品分析和后续 Agent 功能
> 关联设计：[`pob-build-object-design.md`](./pob-build-object-design.md)

## 1. 目标

装备分析 Agent 的目标不是只给出一个“更好”或“更差”的结论，而是让用户知道：

- 装备原始数据是什么，来自哪里。
- 面板属性如何由底材、品质和局部词缀得到。
- 两件装备在相同口径下具体差多少。
- 某个词缀影响武器自身面板、角色技能伤害，还是只在特定条件下生效。
- 把候选装备换入当前构筑后，主技能、Full DPS、防御和资源发生什么变化。
- 结论采用了哪些版本、Config、市场数据和假设，是否存在不确定性。

Agent 必须以结构化数据和确定性计算为基础。语言模型负责理解问题、选择工具、组织解释和提示风险，不负责重新实现一套近似 PoB 公式。

## 2. 与现有路线图的关系

本规范是以下能力共用的语义层：

- `ROADMAP M3`：技能伤害、全局增益与计算可信度。
- `ROADMAP M4`：国际服/国内服装备价格查询。
- `ROADMAP M5`：装备提升与购买建议。
- `ROADMAP M6`：游戏内查价器与构筑提升浮层。
- `ROADMAP M8`：双构筑比较与伤害构成解释。

市场来源、PoB Worker、剪贴板解析和 UI 可以分别实现，但必须复用同一套装备语义、比较口径和结果模型。

### 2.1 当前阶段范围

当前阶段优先完善基础领域能力，不实现 Agent 对话编排、自动推荐策略或复杂 Prompt：

1. 可靠解析物品、词条来源、孔位和底材。
2. 准确计算物品自身面板并支持同口径比较。
3. 建立统一的攻击构成分类和来源追踪。
4. 从 PoB calculation breakdown 获取完整构筑结果。
5. 支持相同 Config 下的前后计算快照和边际贡献分析。

这些能力必须可以被装备页、计算页和测试直接使用，不依赖 Agent 才能成立。Agent 是它们成熟后的一个消费者，不应反向决定底层数据结构或计算公式。

## 3. 证据来源与优先级

### 3.1 事实优先级

1. 用户当前游戏版本复制出的完整物品文本或可验证截图。
2. 用户导入的 PoB Code 中保存的物品 XML。
3. 项目内对应版本的 PoB 数据、Lua 计算规则和 calculation breakdown。
4. 项目生成的底材、符文、翻译和图标 catalog。
5. PoE2DB 等补充来源，仅用于 PoB 缺失的说明、图片或市场辅助信息。
6. 通用机制知识，只能用于解释，不能覆盖版本化数据和实际游戏结果。

冲突时必须保留冲突记录，不得静默选择对 Agent 更方便的值。游戏实际文本与项目底材不一致时，应提示可能存在版本差异、生成数据过期或基底匹配错误。

### 3.2 项目内主要来源

| 资料 | 用途 |
|---|---|
| `public/data/item-bases.json` | 运行时底材、武器和防具基础值、需求 |
| `public/pob-lua/Classes/Item.lua` | PoB 局部武器、防具、品质和 DPS 计算语义 |
| `public/pob-lua/Classes/ItemsTab.lua` | PoB 装备属性与 DPS 显示格式 |
| `public/pob-lua/Data/Bases/` | 版本化底材原始数据 |
| `public/data/rune-details.json` | 符文、灵魂核心、雕像等镶嵌物说明 |
| `src/engine/equipment.ts` | PoB 物品 XML、词条分组和孔位解析 |
| `src/engine/itemDisplayStats.ts` | 当前前端物品面板与武器摘要推导 |
| `src/engine/pobLuaWorker.ts` | 完整构筑的 PoB Lua 计算入口 |

`public/` 下的资源是生成产物。发现错误时应修复上游、解析器或生成脚本并重新生成，禁止把手工修补生成文件作为长期方案。

### 3.3 来源元数据

每个 Agent 结论至少应携带：

- `sourceType`：clipboard、buildXml、pobData、pobCalc、trade 或 assumption。
- `sourceVersion`：游戏/天赋树/PoB 数据版本，无法确定时为 `unknown`。
- `sourcePath` 或稳定实体 ID，不向用户泄露不必要的本机路径。
- `confidence`：exact、derived、estimated 或 unavailable。
- `warnings`：版本冲突、缺失底材、未识别词条、条件未设置等。

## 4. 分析层级

### 4.1 L0：原始事实

只解析和展示物品已有内容：

- 稀有度、名称、底材、物品等级、品质、需求和孔位。
- 显式、隐式、符文、附魔、打造、破碎、亵渎等词条及标签。
- 游戏文本已经汇总出的物理、元素、混沌伤害和防御属性。

这一层不评价装备，也不假设用户的技能或敌人条件。

### 4.2 L1：物品自身面板

使用底材和局部词条计算物品自身可复算的面板值：

- 武器：物理/元素/混沌伤害区间、暴击率、APS、装填时间。
- 防具：护甲、闪避、能量护盾、符文结界、格挡。
- 需求：品质或明确局部效果作用后的力量、敏捷、智慧需求。
- 武器摘要：`APS / DPS / pDPS / eDPS`。

L1 不使用天赋、其他装备、技能、角色 Buff、敌人状态或 Config。

### 4.3 L2：物品自身对比

在统一版本和统一处理规则下比较两件物品：

- 原始属性与词条逐项对齐。
- 计算绝对差值和百分比差值。
- 明确是否忽略品质、符文、孔位或某类词条。
- 分离“武器面板更高”和“可能让当前构筑更强”两种结论。

若用户要求“忽略符文”，必须从最终面板中扣除符文提供的局部效果，不能只在词条列表里隐藏符文。

### 4.4 L3：完整构筑收益

在当前 `PobBuildObject` 的不可变临时副本中替换候选物品，使用 PoB Worker 在相同 Config 下重新计算：

- 主技能 DPS、Full DPS、单次命中、攻击/施法频率。
- 生命、能量护盾、护甲、闪避、抗性、格挡、恢复和 EHP。
- 属性需求、资源、技能等级、触发条件和装备可用性。
- 前后 calculation breakdown 及主要贡献来源。

这一层才能回答“哪件装备对我的 BD 更强”。只比较 `pDPS/eDPS` 不能替代 L3。

### 4.5 L4：市场与购买建议

在 L3 基础上加入市场价格、服务器、赛季、在线状态和抓取时间，提供：

- 指定预算内的候选排序。
- DPS、防御、综合收益和单位货币收益。
- 必须保留的词缀、抗性/属性下限和负面变化限制。
- 价格样本量、来源、缓存时间和不确定性。

Agent 不自动联系卖家、不自动购买，也不绕过交易网站验证。

## 5. 武器面板计算口径

### 5.1 最终 APS

```text
APS = AttackRateBase * (1 + LocalAttackSpeedIncrease / 100)
```

只计算武器自身的局部攻击速度。角色天赋、其他装备、Buff 和技能速度不改变武器面板 APS。

### 5.2 最终物理伤害

```text
PhysicalMin = round(
  (BasePhysicalMin + LocalAddedPhysicalMin)
  * (1 + LocalPhysicalIncrease / 100)
  * (1 + Quality / 100)
)

PhysicalMax 同理
```

品质是独立乘区，不应简单并入 `increased Physical Damage`。面板区间先按游戏/PoB 规则取整，再用于物品 DPS。

### 5.3 元素和混沌伤害

```text
Elemental = Fire + Cold + Lightning
Chaos 单独记录
```

`eDPS` 只包含火焰、冰霜和闪电。混沌伤害计入总 `DPS`，但不得混入 `eDPS` 或顶部“元素伤害”。

### 5.4 DPS 摘要

```text
pDPS = average(PhysicalMin, PhysicalMax) * APS

eDPS = (
  average(FireMin, FireMax)
  + average(ColdMin, ColdMax)
  + average(LightningMin, LightningMax)
) * APS

ChaosDPS = average(ChaosMin, ChaosMax) * APS

DPS = pDPS + eDPS + ChaosDPS
```

展示规则：

- 顺序固定为 `APS / DPS / pDPS / eDPS`。
- DPS 类字段保留一位小数，APS 遵循武器面板精度。
- 对应伤害为零时不显示该分项。
- 只对具有有效 `weapon.AttackRateBase` 的实际战斗武器显示。
- 施法法杖、施法长杖、防具、饰品和钓鱼竿不显示。
- 弩的物品 DPS 沿用市场口径；装填时间不并入 APS。持续输出能力应在技能/构筑层单独解释。

## 6. 防具和需求计算口径

防御属性以每个属性自己的基础值、局部点数、局部提高和品质计算：

```text
FinalDefence = round(
  (BaseDefence + LocalFlatDefence)
  * (1 + LocalDefenceIncrease / 100)
  * (1 + Quality / 100)
)
```

适用于护甲、闪避、能量护盾和符文结界。组合词条如 `increased Armour and Energy Shield` 必须作用到它命名的每个防御属性。

当前已验证案例：

- 符文宏伟护腕：`759` 闪避、`76` 符文结界。
- 品质后的属性需求必须以游戏实际值和对应版本规则校验，不能假设所有版本永远使用同一品质减需求公式。

## 7. 局部词条与全局词条

### 7.1 可以改变武器自身面板的典型词条

- `Adds X to Y Physical/Fire/Cold/Lightning/Chaos Damage`，前提是物品语义为武器局部点伤。
- `increased Physical Damage` 的武器局部版本。
- `increased Attack Speed` 的武器局部版本。
- 武器局部暴击率、武器范围和明确的 WeaponData 修改。
- 符文或灵魂核心提供的上述局部效果。

仅凭中文显示文本可能无法判断 local/global。优先使用 PoB 解析后的 mod 类型、标签和 `Item.lua` 结果；正则解析只作为有限降级方案。

### 7.2 不改变武器自身 DPS 的典型词条

- `increased Elemental Damage with Attacks`。
- `increased Attack Damage against Rare or Unique Enemies`。
- `Gain X% of Damage as Extra Damage of all Elements`。
- 技能速度、技能等级、保留效能、获得球等效果。
- 天赋、其他装备、角色 Buff 和敌人状态提供的攻击伤害或速度。

这些词条可能显著改变完整构筑 DPS，但对物品自身 `DPS/pDPS/eDPS` 的贡献为零。

### 7.3 increased 的解释

同类 `increased` 通常加算。某条 `136% increased` 对最终伤害的相对提升不是固定 136%：

```text
RelativeGain = AddedIncrease / (100 + ExistingIncrease)
```

因此 Agent 不得用物品 eDPS 判断全局增伤词缀的实际价值。必须进入 L3，通过相同 PoB Config 比较。

### 7.4 攻击构成的统一分类

项目将玩家常用的“点伤、Increased、Gain、More”作为攻击解释的四个核心层，同时保留完整 DPS 所需的其他层：

| 分类 | 说明 | 基础能力要求 |
|---|---|---|
| 基础与点伤 | 武器基础、技能基础和各来源附加点伤 | 记录伤害类型、范围、来源和点伤效用 |
| 转化与 Gain | 伤害类型转化及 `Gain as Extra` 分支 | 记录来源类型、目标类型、比例和适用条件 |
| Increased | 所有适用的提高/降低加算池 | 记录总池、单项来源和适用域 |
| More/Less | 独立乘区和条件型倍率 | 记录每个乘区、条件与是否生效 |
| 速度与次数 | APS、技能频率、重复、触发和有效命中数量 | 区分武器 APS 与技能实际频率 |
| 命中与暴击 | 命中率、暴击率、暴击伤害 | 展示期望伤害中的独立影响 |
| 敌人侧修正 | 抗性、穿透、降抗和承受伤害 | 必须绑定明确的敌人 Config |

前四类用于快速解释伤害如何形成，后三类用于解释单次伤害如何变成最终有效 DPS。持续伤害、异常状态、召唤物和触发技能需要各自的子模型，不能强行塞入一次命中公式。

`Gain` 不等同于固定 `More`。它生成新的伤害分支，实际价值会受到原始伤害构成、转化路径、对应伤害类型增伤和敌人抗性的共同影响。具体顺序和数值以 PoB Lua breakdown 为准。

### 7.5 当前构筑下的边际贡献

基础计算层应支持通过相同 Config 的前后快照评估某个来源：

```text
MarginalContribution = BaselineMetric - MetricWithoutSource
```

例如解释一条 `136% increased Elemental Damage with Attacks` 时，应在临时物品副本中移除该来源并重新计算，而不是把 `136%` 直接当成最终提升。

边际贡献具有上下文：它依赖技能、装备、Config 和其他词条。多个来源之间存在交互，各自边际贡献之和可能不等于总伤害，因此 UI 不应把它们伪装成必然加总为 100% 的饼图。结果必须标明基线快照和计算条件。

## 8. 符文、灵魂核心和独立镶嵌物

PoB 物品可能同时保存：

- `Rune: <name>`：镶嵌物名称。
- `{rune}` 或 `{enchant}{rune}`：已经展开到母物品的实际效果。
- `J` 孔中的独立 `socketedItems`：作为独立物品保存的珠宝或其他对象。

处理规则：

1. 已展开在母物品上的局部 rune 效果参与 L1 计算。
2. 只有名称、没有展开效果时，可使用稳定 ID/规范英文名查询 rune catalog 作为兜底。
3. 名称兜底与展开词条同时存在时必须去重，不能计算两次。
4. 独立珠宝的全局角色效果不计入母武器面板，进入 L3 构筑计算。
5. 用户要求忽略符文时，从输入 modifier 集合中排除 rune 来源后重新推导面板。
6. `Bonded`、条件效果或特殊规则无法由通用局部公式处理时，交给 PoB Lua，不做文本猜测。

## 9. 传奇和特殊装备

普通、魔法、稀有、传奇装备应共用同一基础流程，不为单件装备写名称特判。

特殊装备可能包含：

- 根据角色状态改变武器数据。
- 伤害转化、无物理伤害、特殊品质或动态基础值。
- 条件型 local/global 效果。
- 多变体、替代形态、赋予技能或特殊插槽规则。

出现这些情况时：

1. 优先读取 PoB 已计算的 `weaponData`、`armourData` 和 breakdown。
2. 无可靠结构化结果时，将字段标记为 unavailable 或 estimated。
3. 不因 UI 需要一个数字而编造近似结果。
4. 建立通用规则或 parity fixture，不建立物品名称白名单。

## 10. 对比输出规范

### 10.1 默认表格

```text
| 指标 | 当前装备 | 候选装备 | 差异 |
|---|---:|---:|---:|
| APS | 1.75 | 1.75 | 0 |
| DPS | 768.3 | 783.1 | +14.8 |
| pDPS | 153.1 | 155.8 | +2.7 |
| eDPS | 615.1 | 627.4 | +12.3 |
```

默认同时展示收益和损失。不得只列候选装备更高的字段。

### 10.2 结论措辞

- L1/L2 可以说：“候选武器面板 DPS 高 1.9%”。
- 没有 L3 计算时不能说：“候选装备让你的 BD 提升 1.9%”。
- 条件不一致时应说：“无法直接比较，先统一 Boss、球数、技能阶段等 Config”。
- 缺失词条或版本不明时应明确标注，不输出伪精确百分比。

### 10.3 用户控制项

Agent 应支持明确的比较选项：

- 是否忽略品质。
- 是否忽略符文/灵魂核心/雕像。
- 是否统一到相同孔位方案。
- 是否只比较物品面板，或代入完整构筑。
- 目标技能、武器组、敌人类型和 Config。
- 是否计入价格与预算。

Agent 应复述会实质改变结果的选项，但不重复用户已经明确给出的条件。

## 11. Agent 工具边界

以下接口是基础领域服务的远期调用形态。当前阶段先实现并验证其底层能力，不实现 Agent 编排：

```text
parseBuildCode(code) -> PobBuildObject
parseClipboardItem(text) -> ParsedItem
resolveItemBase(item, dataVersion) -> ItemBase
deriveIntrinsicItemStats(item, base, options) -> IntrinsicStats
compareIntrinsicItems(left, right, options) -> ItemComparison
simulateItemReplacement(build, slot, candidate, config) -> BuildComparison
getCalculationBreakdown(buildComparison, metric) -> Breakdown
searchTrade(query, provider) -> TradeResults
rankCandidates(build, candidates, constraints) -> RankedCandidates
```

核心原则：

- 解析器输出稳定 ID、原始文本、标签和来源，不只输出翻译后的字符串。
- L1/L2 使用共享领域函数，不能由 React 组件或 Agent prompt 各算一遍。
- L3/L4 通过 PoB Worker 计算；前端和 Agent 不根据最终 DPS 反推构成。
- 所有比较采用不可变临时副本，不修改用户当前构筑，除非用户明确确认替换。
- 工具返回结构化 warning，Agent 必须向用户呈现关键 warning。

## 12. 建议的数据契约

```ts
type Confidence = 'exact' | 'derived' | 'estimated' | 'unavailable'

interface EvidenceRef {
  sourceType: 'clipboard' | 'buildXml' | 'pobData' | 'pobCalc' | 'trade' | 'assumption'
  sourceVersion?: string
  entityId?: string
  confidence: Confidence
}

interface DerivedMetric {
  key: string
  value?: number
  displayValue: string
  unit?: string
  evidence: EvidenceRef[]
  formulaId?: string
  warnings: string[]
}

interface ItemComparison {
  baseline: DerivedMetric[]
  candidate: DerivedMetric[]
  deltas: DerivedMetric[]
  options: {
    ignoreQuality: boolean
    ignoreSocketedEnhancements: boolean
    buildAware: boolean
  }
  warnings: string[]
}
```

正式实现时应增加 schema version，并让 UI、Worker、Agent 和持久化层共享类型定义。

## 13. 失败与降级

| 情况 | 行为 |
|---|---|
| 找不到底材 | 展示原始物品文本；停止派生底材相关数值 |
| 存在未识别词条 | 标记词条；继续计算不受影响的字段 |
| Lua Worker 不可用 | 保留 L0-L2；禁用 L3/L4 构筑收益结论 |
| Config 不完整 | 展示缺失条件；不比较最终构筑 DPS |
| 市场服务失败 | 保留装备分析；不显示过期价格为实时价格 |
| 游戏与项目值冲突 | 同时展示两个值、版本和差异，不静默覆盖 |
| 特殊装备无法建模 | 返回 unavailable，并说明需要 PoB 支持或 fixture |

## 14. 测试策略

### 14.1 固定样例

至少保留以下脱敏 fixture：

- 带品质、物理、火焰、闪电、攻速、暴击和三个符文的稀有战斗武器。
- 带局部闪避点数、复合闪避提高、品质和符文结界的手套。
- 只有物理伤害、只有元素伤害和带混沌伤害的武器。
- 弩、施法法杖、施法长杖、钓鱼竿和无 `weapon` 数据的装备。
- 带局部伤害符文、只有符文名称、同时包含名称和展开效果的三种导入形式。
- 包含特殊 WeaponData 的传奇装备。

### 14.2 验证层级

1. 解析测试：PoB XML、剪贴板和标签分组。
2. 领域单测：品质、局部词条、取整、DPS 和防御值。
3. parity fixture：与桌面 PoB/LuaJIT 的 weaponData、armourData 和构筑输出对比。
4. UI 测试：桌面/窄视口无溢出，摘要字段顺序稳定。
5. Agent eval：相同输入能引用正确证据、遵守用户忽略项、不混淆物品 DPS 与构筑 DPS。
6. 市场集成测试：服务器、赛季、时间、缓存和失败降级。

浮点字段必须定义容差；面板整数、枚举和字段是否显示应完全一致。

## 15. 当前已验证案例

当前 BD 中的稀有节杖在不计全局/条件词条时：

```text
Physical Damage: 66-109
Fire Damage: 147-220
Lightning Damage: 2-334
APS: 1.75
DPS: 768.3
pDPS: 153.1
eDPS: 615.1
```

以下词条对物品自身 DPS 贡献为零，但可能影响完整构筑：

- `136% increased Elemental Damage with Attacks`
- `50% increased Attack Damage against Rare or Unique Enemies`
- `Gain 5% of Damage as Extra Damage of all Elements`
- 技能速度、攻击技能等级、保留效能和获得球效果

如果三个局部闪电符文合计提供 `Adds 3 to 120 Lightning Damage`，其他属性不变：

```text
Lightning Damage: 5-454
APS: 1.75
DPS: 875.9
pDPS: 153.1
eDPS: 722.8
```

这个例子只能说明武器自身面板变化。是否优于保留全局元素攻击增伤的方案，必须通过 L3 完整构筑计算判断。

## 16. 实施顺序

### 阶段 A：物品基础能力

1. 把当前物品解析和面板推导收敛为独立领域模块，移出 UI 组件职责。
2. 为 modifier 增加稳定 ID、local/global、来源、攻击构成分类和适用域，不再主要依赖英文正则。
3. 实现统一 `IntrinsicStats` 和 `ItemComparison`，供装备页与测试直接使用。
4. 建立真实物品 fixture，覆盖品质、符文、局部/全局词条、传奇和特殊 WeaponData。

完成标准：不启动 PoB 完整构筑计算，也能可靠展示和比较物品自身面板，并说明哪些词条不能在物品层估值。

### 阶段 B：完整构筑分析基础

1. 扩展 `PobEngineClient`，支持临时替换物品、Config 快照和 calculation breakdown。
2. 将点伤、转化/Gain、Increased、More/Less、速度、暴击和敌人侧数据映射为统一 breakdown。
3. 实现前后快照、单来源移除测试和边际贡献结果。
4. 建立与桌面 PoB/LuaJIT 的 parity fixtures 和浮点容差报告。

完成标准：装备页和计算页在没有 Agent 的情况下，也能回答“换装后哪些指标变化、主要原因是什么”。

### 阶段 C：后续产品能力

1. Agent 只调用已经稳定的解析、比较和 breakdown 服务，不自行计算伤害。
2. 接入 TradeProvider、预算约束、候选排序和单位价格收益。
3. 复用同一结果模型实现游戏内浮层和自然语言解释。

在 L1/L2 稳定但 L3 尚未完成时，可以发布“物品面板分析 Agent”，但必须明确标注它不能判断完整 BD 的最终提升。
