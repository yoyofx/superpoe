# SuperPoE2 装备差异统计详细设计

> 状态：方案设计，尚未开始实现
>
> 更新日期：2026-08-17
>
> 目标：完整还原 PoB2 的装备差异统计语义。UI 可以适配 SuperPoE2，但候选装备的槽位判断、装备/移除行为、计算结果、差异过滤、排序和颜色含义必须与 PoB2 一致。

## 1. 结论摘要

这个功能可以在当前项目中实现，但不能由前端根据词缀、面板属性或 DPS 公式自行推算。PoB2 的差异统计实际上是一次“带临时装备覆盖的完整构筑计算”：

1. 先计算当前构筑的基准输出。
2. 找出候选装备可以放入的全部合法槽位。
3. 对每个槽位分别执行一次 repSlotName + repItem 覆盖计算。
4. 如果候选装备已经是该槽位当前装备，则使用 repItem = nil，得到移除装备后的输出。
5. 将候选输出与基准输出按 PoB2 的 displayStats 规则逐项比较，只保留有变化的项目。
6. 按 PoB2 的槽位排序规则生成一个或多个差异区段。

正确的实现边界是：

- Lua 负责物品解析、合法槽位判断、临时装备覆盖和数值计算。
- 项目自有桥接层负责把 PoB2 的差异结果转换成结构化数据。
- 前端只负责展示结构化结果，不解析 Tooltip 文本，也不根据词缀重新计算。
- 普通装备、已穿戴装备、戒指/武器双槽位、珠宝孔、药剂、护符、触发技能、召唤物和条件统计都必须保留 PoB2 语义。

## 2. 参考源码和当前实现边界

### 2.1 PoB2 参考源码

本设计基于当前仓库内的 PoB2 Lua 源码（当前版本 v0.23.0）：

| 文件 | 作用 |
| --- | --- |
| public/pob-lua/Classes/ItemsTab.lua | 装备 Tooltip、合法槽位枚举、已穿戴判断、槽位排序 |
| public/pob-lua/Modules/Build.lua | CompareStatList 和 AddStatComparesToTooltip 差异过滤/格式化 |
| public/pob-lua/Modules/Calcs.lua | getMiscCalculator、临时覆盖计算和 Full DPS 计算 |
| public/pob-lua/Modules/CalcSetup.lua | 计算环境初始化、配置和当前输出 |
| public/pob-lua/Classes/Item.lua | GetPrimarySlot 等装备类型默认映射 |
| public/pob-lua/Modules/BuildDisplayStats.lua | 显示统计项顺序、单位、条件、颜色方向和百分比规则 |

关键入口是 ItemsTab:AddItemTooltip()。普通装备分支获取
calcFunc、calcBase = self.build.calcsTab:GetMiscCalculator()，之后按槽位调用
calcFunc({ repSlotName = ..., repItem = ... })，再调用
Build:AddStatComparesToTooltip()。

本次核对的关键源码位置（以当前 bundle 为准）：

- ItemsTab.lua 3321：AddItemTooltip() 入口。
- ItemsTab.lua 3790：showStatDifferences 开关和 GetMiscCalculator()。
- ItemsTab.lua 4024：普通装备的合法槽位枚举。
- ItemsTab.lua 4034：repItem 判定，候选等于当前装备时传 nil。
- ItemsTab.lua 4064：限定传奇过滤和比较结果排序。
- ItemsTab.lua 2258：GetComparisonSlotNameForItem()。
- ItemsTab.lua 2275：IsItemValidForSlot()。
- Build.lua 2271：CompareStatList() 的差值、条件和格式规则。
- Calcs.lua 72：getMiscCalculator() 的基础环境和覆盖计算。

### 2.2 SuperPoE2 当前实现

当前项目已经有：

- src/engine/pobLuaRuntime.ts：Wasmoon Lua 运行时和计算脚本。
- src/engine/pobLuaWorker.ts：浏览器 Worker、Lua 文件挂载和请求队列。
- src/engine/pobLuaClient.ts：前端计算 API。
- electron/pobLuaService.ts：LuaJIT sidecar 和请求协议。
- native/pob-lua-runner.lua：LuaJIT sidecar 请求处理。
- src/engine/calculationCache.ts：完整构筑结果的内存 LRU 缓存。
- src/types/calc.ts：当前计算结果类型。

当前 calculateBuild() 主要是每次根据 XML 加载构筑并执行计算；LuaJIT sidecar 只对完全相同的输入做结果缓存，尚没有独立的装备候选比较请求，也没有持久的 getMiscCalculator 比较会话。因此，直接连续调用普通构筑计算虽然可以得到数值，但不能满足 PoB2 的多槽位行为，也会重复加载和初始化构筑。

## 3. PoB2 行为的完整定义

### 3.1 基准输出和候选输出

定义以下术语：

- baseOutput：当前构筑当前装备、当前天赋、当前技能和当前配置下的输出。
- candidateOutput(slot)：把候选装备临时放到指定合法槽位后的输出。
- removeOutput(slot)：从指定槽位移除当前装备后的输出。
- displayStats：PoB2 用来显示人物差异的有序统计项列表。
- minionDisplayStats：当前技能产生召唤物时，召唤物的差异统计项列表。

PoB2 通过 calcs.getMiscCalculator(build) 先创建一个计算闭包。该闭包会：

1. 初始化计算环境并计算基准环境。
2. 保存可复用的基础 ModDB、EnemyDB 和 MinionDB。
3. 每次调用前清理上一次临时覆盖。
4. 应用本次 override。
5. 重新执行计算和 Full DPS 汇总。

临时覆盖必须由 Lua 计算器执行，不能把 CalcResult 里的几个字段复制后由 TypeScript 手动相加。

### 3.2 普通装备：枚举全部合法槽位

如果装备不是药剂或护符，PoB2 会遍历 self.slots，保留同时满足以下条件的槽位：

- IsItemValidForSlot(item, slotName) 返回真。
- 槽位不是 inactive。
- 槽位属于当前武器组，或不是武器组限定槽位。
- 槽位当前可见（slot.shown()）。

没有明确槽位时，不能只选择 DPS 最高的一个结果。必须为所有合法槽位计算并返回结果。例如同一个戒指候选可能同时产生 Ring 1 替换结果和 Ring 2 空槽结果。

如果 SuperPoE2 的设置等价于 PoB2 的 slotOnlyTooltips，并且 Tooltip 是从具体装备槽位打开的，则可以只比较该槽位；否则必须显示全部合法槽位。

### 3.3 已穿戴装备：移除和替换必须区分

每一个比较槽位都要读取该槽位当前选中的装备 selItem。覆盖参数的精确定义为：

    local selItem = self.items[compareSlot.selItemId]
    local output = calcFunc({
        repSlotName = compareSlot.slotName,
        repItem = item ~= selItem and item or nil,
    })

含义如下：

| 情况 | repItem | 文案语义 |
| --- | --- | --- |
| 候选装备不是该槽位当前装备 | 候选 Item 对象 | 装备/替换候选装备 |
| 候选装备就是该槽位当前装备 | nil | 移除当前装备 |
| 候选装备在另一槽位已穿戴 | 候选 Item 对象 | 仍按当前比较槽位计算，不能按名称猜测 |

判断必须优先使用构筑内 Item ID 或对象身份。不能因为两个装备名称相同，或 Raw 文本相同，就把它们错误判定成移除当前装备。

如果同一个 Item ID 被多个 item set 或槽位引用，比较时以当前激活 item set 和当前可见槽位为准，并分别产生每个槽位的操作结果。

### 3.4 限定传奇装备的槽位过滤

PoB2 会先对所有合法槽位计算结果。如果候选是有限数量的传奇装备，并且当前合法槽位中已经有达到 item.limit 数量的同名传奇装备，则只显示这些同名传奇所在槽位的比较结果。

这个规则不能在前端按装备名称简单过滤，必须使用 PoB Item 解析出的 rarity、name 和 limit，并使用当前激活 item set 的槽位状态。

### 3.5 槽位排序

PoB2 对所有比较结果执行稳定排序，优先级从高到低为：

1. 空槽位优先。
2. 相同传奇装备，或相同基底类型/子类型优先。
3. FullDPS 高者优先。
4. CombinedDPS 高者优先。
5. TotalEHP 高者优先。
6. 槽位显示标签。
7. 槽位内部名称。

缺失字段不能导致异常；应按 PoB2 的 nil 继续比较行为处理。不能只返回排序后的第一项，因为用户需要看到不同槽位的完整差异。

### 3.6 默认槽位和合法槽位不是一回事

Item:GetPrimarySlot() 只用于没有具体槽位时提供默认槽位，例如戒指到 Ring 1、武器到 Weapon 1、盾牌/箭袋到 Weapon 2。它不是最终的比较限制。最终是否可比较必须调用 ItemsTab:IsItemValidForSlot() 并枚举所有槽位。

### 3.7 合法槽位规则必须复用 Lua

IsItemValidForSlot() 当前涵盖的规则包括：

- 普通珠宝孔、邪恶/限制珠宝孔、Lich socket。
- Charm socket 和 Charm 类型。
- Cluster Jewel 尺寸与外圈/内圈限制。
- 珠宝孔所属装备对 Jewel base 的限制。
- 生命/魔力药剂与 Flask 1/Flask 2 的限制。
- Transcendent Arm/Leg。
- Weapon 1/Weapon 2 的单手、双手、弓/箭袋、法杖/Focus、Talisman/Sceptre 规则。
- Giant's Blood、Instruments of Power、Lord of the Wilds 等关键石板对武器槽位的影响。
- 当前武器组和 Swap 武器组的可见状态。

项目不得在 TypeScript/React 中重新实现这组规则。比较桥接层应把候选 Item 交给 Lua 的 IsItemValidForSlot()，必要时传入和 PoB2 相同的 flagState。

### 3.8 药剂和护符是切换比较

PoB2 在普通装备分支前处理：

- base.flask 存在时调用 calcFunc({ toggleFlask = item })。
- Charm 数据存在时调用 calcFunc({ toggleCharm = item })。

这两类装备只有一个切换语义：当前已激活时比较停用结果，当前未激活时比较启用结果。不能强行映射到普通 repSlotName + repItem 流程，否则持续时间、充能、生命/魔力恢复和 Charm effect 等统计会偏离 PoB2。

### 3.9 差异统计算法

PoB2 的 Build:CompareStatList() 对每个显示统计项按定义顺序执行：

    local candidateValue = compareOutput[stat] or 0
    local baseValue = baseOutput[stat] or 0
    local diff = candidateValue - baseValue

只有满足以下条件才显示：

- diff > 0.001 或 diff < -0.001。
- condFunc 在候选输出或基准输出至少一侧满足。
- 当前 actor 的技能 flag 满足 flag/notFlag 条件。
- childStat 和 SkillDPS 不作为普通标量行输出。

特殊规则：

- FullDPS 在候选输出没有该字段时按 PoB2 特殊处理，不显示虚假的下降。
- pc 或 mod 统计项的差值显示值乘以 100。
- compPercent 且两侧都不为零时，附加 candidate / base * 100 - 100 的百分比。
- lowerIsBetter 决定降低是否使用正向颜色，例如施法时间、冷却时间、资源消耗。
- 玩家和召唤物分别输出；有召唤物差异时，标题顺序和 PoB2 一致。
- 统计项顺序来自 BuildDisplayStats.lua，不能按数值大小或前端字母序排序。

实现必须保留数值、显示值、百分比、格式和颜色方向等元数据，不能只返回拼接后的字符串。

### 3.10 PoB2 中不显示的项目

以下内容不能被错误地当作普通差异行：

- SkillDPS 是技能列表数据，不属于普通标量差异列表。
- 没有变化的字段不输出。
- 只有候选一侧或基准一侧拥有 condFunc 所需条件时，仍按“两侧任一满足”判断。
- FullDPS 缺失时不得显示 0 到非零或非零到 0 的伪差异。

## 4. SuperPoE2 目标数据模型

### 4.1 请求模型

建议新增项目自有类型 src/types/equipmentDifference.ts：

    export interface EquipmentDifferenceRequest {
      build: {
        xml: string
        buildRevision: string
        activeItemSetId?: string
        activeWeaponSet: 1 | 2
        configOverrides?: Record<string, boolean | number | string>
      }
      candidate: {
        raw: string
        buildItemId?: number
        source: 'equipment-slot' | 'equipment-library' | 'market-listing' | 'custom'
      }
      sourceSlotName?: string
      slotOnlyTooltips?: boolean
    }

buildRevision 必须由构筑状态层递增或稳定生成。它不能只依赖候选装备名称；天赋、技能、配置、装备组和武器组变化都必须让比较上下文失效。

### 4.2 结构化统计项

    export interface EquipmentDiffStat {
      key: string
      label: string
      actor: 'player' | 'minion'
      baseValue: number
      candidateValue: number
      delta: number
      displayDelta: number
      percent?: number
      format?: string
      positive: boolean
      lowerIsBetter: boolean
      compPercent: boolean
      color: 'positive' | 'negative'
    }

delta 保留原始数值差，displayDelta 应用 pc/mod 的百分比换算后用于显示。percent 只在 PoB2 compPercent 且两侧非零时存在。前端不能重新推断 positive 或 color。

### 4.3 槽位结果

    export interface EquipmentSlotDiff {
      slotName: string
      slotLabel: string
      operation: 'equip' | 'remove' | 'toggle-on' | 'toggle-off'
      replacedItemId?: number
      replacedItemName?: string
      changedStats: EquipmentDiffStat[]
      sort: {
        empty: boolean
        similar: boolean
        fullDps?: number
        combinedDps?: number
        totalEhp?: number
      }
    }

    export interface EquipmentDifferenceResult {
      success: boolean
      contextKey?: string
      groups?: EquipmentSlotDiff[]
      warnings?: string[]
      performance?: {
        sessionReused: boolean
        baseCalculationMs: number
        candidateCalculationMs: number
        cacheHit: boolean
      }
      error?: {
        code: 'invalid-build' | 'invalid-item' | 'no-valid-slot' | 'calculation-failed' |
          'stale-context' | 'runtime-unavailable'
        message: string
      }
    }

groups 只包含 PoB2 实际会产生至少一条差异统计的区段。空区段不能为了“显示槽位”而制造假的标题；被过滤的槽位如需诊断，应通过单独的 debug 字段返回。

## 5. 计算会话、缓存和失效

### 5.1 为什么需要专用比较会话

单次 Tooltip 可能需要对 Ring 1、Ring 2、多个 Jewel Socket 和武器槽位分别计算。如果每次都走当前 calculateBuild()，会重复解析 XML、创建 Build、初始化 Calcs、构造基础数据库并计算基准 Full DPS。

需要在 Lua 运行时中建立短生命周期的 EquipmentComparisonSession：

1. 使用当前构筑 XML 加载一次 Build。
2. 读取当前 item set、武器组和配置。
3. 创建一次 build.calcsTab:GetMiscCalculator()。
4. 保存不可变的基准输出快照。
5. 对候选的每个槽位调用同一个 calculator closure。
6. 每次调用后立即深拷贝输出，避免 Lua 环境被下一次调用覆盖。

getMiscCalculator() 产生的闭包不是线程安全对象。Worker、LuaJIT sidecar 和 Electron IPC 都必须保证同一 session 内的比较请求串行执行。

### 5.2 Context Key

建议按以下内容生成 contextKey：

    schemaVersion
    PoB Lua bundle version/hash
    build XML hash
    buildRevision
    activeItemSetId
    activeWeaponSet
    configOverrides canonical JSON
    main skill/calculation mode if it changes the active output

候选装备不放入 contextKey，而放入候选结果 key。这样同一构筑下的多个候选可以共享一个比较会话。

### 5.3 Candidate Result Key

    contextKey
    candidate Raw hash
    candidate buildItemId (if present)
    requested source slot
    slotOnlyTooltips
    resolved slotName
    operation

候选结果缓存只在同一个 context 内有效。候选 Raw 发生任何变化，包括品质、腐化、附魔、Rune、显式词缀或插槽，都必须产生新 key。

### 5.4 失效规则

以下变化必须丢弃比较 session 和候选结果：

- 构筑 XML 变化。
- 天赋树、技能组、技能等级、支持宝石或触发配置变化。
- 当前装备或装备组变化。
- 当前激活 item set 或 weapon set 变化。
- 配置面板影响计算的值变化。
- PoB Lua bundle 版本/hash 变化。
- 计算 schema 版本变化。

以下变化不必让数值 session 失效：

- 只改变前端 Tooltip 尺寸、主题或语言显示。
- 只改变候选来源标签而不改变候选 Raw。

比较 session 不持久化到磁盘。Lua Build、calculator closure 和 ModDB 不可安全序列化；应用重启后重新建立是正确行为。现有 calculationCache 可以复用相同 context 的完整基准结果作为优化，但不能代替比较 session，也不能绕过 Lua 的 repItem 计算。

### 5.5 内存和生命周期

- 只保留当前构筑 session，最多额外保留一个最近 session。
- 构筑切换、Lua 运行时重启、sidecar 崩溃时全部清空。
- 候选结果采用 LRU，建议最多 64 个槽位结果。
- 结果返回前检查 requestGeneration，过期响应不得覆盖新 Tooltip。

## 6. Lua 桥接层设计

### 6.1 项目自有桥接，不修改上游计算文件

建议新增项目自有 comparison script/helper，分别接入 Wasmoon 和 LuaJIT。它可以调用上游现有对象和方法，但不修改以下上游文件：

- public/pob-lua/Classes/ItemsTab.lua
- public/pob-lua/Modules/Calcs.lua
- public/pob-lua/Modules/Build.lua
- public/pob-lua/Modules/BuildDisplayStats.lua
- public/pob-lua/Classes/Item.lua
- public/pob-lua/Modules/CalcSetup.lua

桥接层负责：

1. 从请求创建候选 Item 对象。
2. 取得当前 itemsTab、active item set、slots 和 calcs tab。
3. 复用 IsItemValidForSlot()、GetEquippedSlotForItem() 和 GetComparisonSlotNameForItem() 的语义。
4. 调用 GetMiscCalculator()，执行普通覆盖或 Flask/Charm toggle。
5. 读取 displayStats/minionDisplayStats，生成结构化差异。
6. 按 PoB2 规则处理限定传奇和槽位排序。

### 6.2 结构化差异采集策略

PoB2 原方法直接向 Tooltip 写入格式化文本。SuperPoE2 不能把最终文本再反向解析为正式协议，因此桥接层应提供结构化 collector：

- 读取上游 displayStats 定义和顺序。
- 按 PoB2 CompareStatList 的条件、阈值、百分比和 lowerIsBetter 规则生成 EquipmentDiffStat。
- 使用上游统计字段名和显示定义，不在 TypeScript 中维护第二份统计表。
- 每个 PoB Lua bundle 版本运行一次 parity test，确认结构化 collector 与 PoB2 Tooltip collector 的差异行集合一致。

这是“复用上游数据定义、项目自有结构化输出”，不是复制一套前端计算公式。若未来上游改变 CompareStatList，bundle 版本/hash 和 parity test 必须使实现进入升级检查，而不是静默沿用旧规则。

### 6.3 基准快照要求

calcBase 和每次候选输出都可能引用正在被下次计算复用的 Lua 表。桥接层必须在返回前做深拷贝，只保留 JSON 可序列化的数值和显示元数据，不能把 Lua table 引用泄漏给 Worker 或 sidecar 外部。

### 6.4 Wasmoon 与 LuaJIT 一致性

同一 comparison request 必须在两种后端产生相同的合法槽位集合、operation、统计 key 和顺序、delta、percent、正负颜色以及槽位排序。

两种后端不得各自维护一套规则。可以共用相同的 Lua bridge source，或通过构建脚本把同一项目脚本嵌入 Worker 和 sidecar；只允许保留运行时适配差异。

## 7. Worker、Native 和 Electron API

### 7.1 Worker 操作

扩展当前 Worker request type，增加 compareEquipment：

1. pobLuaWorker 确保 Lua 初始化。
2. 根据 contextKey 获取或建立 comparison session。
3. 在 operationQueue 中串行执行比较。
4. 返回 EquipmentDifferenceResult。

### 7.2 LuaJIT sidecar 操作

sidecar 增加同名 JSON 请求类型。sidecar 当前是长生命周期进程，但现有 calculate() 的完全相同输入缓存不等于 comparison session；应新增独立 session map、串行锁和清理逻辑。

### 7.3 Electron IPC

建议新增 pob2:lua-compare-equipment。主进程必须执行和 pob2:lua-calculate 同等级别的输入校验：

- XML 和 Raw 必须是非空字符串且限制大小。
- activeWeaponSet 只能是 1 或 2。
- sourceSlotName 只能是短字符串，不允许注入 Lua 代码。
- configOverrides 只允许 boolean/number/string。

Preload 暴露类型安全的方法，Renderer 不直接调用 ipcRenderer。

### 7.4 前端客户端

src/engine/pobLuaClient.ts 增加 compareEquipment(input) 方法。客户端优先使用 LuaJIT，失败后回退 Wasmoon，并保持错误和结果结构一致。后端切换时清空旧 comparison session，不能把一个后端的 Lua 对象状态带到另一个后端。

## 8. 前端展示设计

### 8.1 展示原则

装备详情 Tooltip 只渲染 EquipmentDifferenceResult.groups：

- 每个槽位一段，使用 Lua 返回的 slotLabel。
- equip 显示“装备到 X 后会获得”，包含被替换装备名称。
- remove 显示“从 X 移除该装备后会获得”。
- toggle-on/toggle-off 显示启用/停用药剂或护符。
- 每段只显示 changedStats，顺序严格按 Lua 返回顺序。
- positive/negative 使用项目 Tooltip 颜色映射，不能按 delta 正负重新决定。
- percent 作为 PoB2 同行括号百分比展示。
- 有召唤物时保留 Player/Minion 分组顺序。

如果没有任何合法槽位或所有比较项都没有变化，应分别展示“无法比较”或“没有可显示差异”状态；不能伪造一行 +0 DPS。在完全复刻 PoB2 的 Tooltip 模式下，空差异区段本身不显示标题。

### 8.2 具体槽位和候选装备

从装备面板某个已穿戴槽位打开详情时，默认传入 sourceSlotName。是否只显示该槽位由项目设置控制，默认行为应与 PoB2 的 slotOnlyTooltips 约定一致。

从装备库、集市候选或自定义装备打开详情时，通常没有具体槽位，必须显示所有合法槽位结果。前端不能只显示第一条或第一条 DPS 最高的结果。

### 8.3 UI 计算状态

Tooltip 是高频悬停场景，必须有：

- 150-250ms 去抖，避免鼠标快速经过大量装备时启动大量 Lua 计算。
- 同一 contextKey + candidateKey 的请求去重。
- 新 Tooltip 打开时递增 generation，旧响应即使完成也丢弃。
- 首次计算显示紧凑的“正在计算差异”状态，不阻塞装备详情基础信息。
- 计算失败时保留物品详情，并在差异区段显示明确错误，不影响其它面板。

## 9. 错误和边界行为

| 场景 | 处理 |
| --- | --- |
| 构筑 XML 无法加载 | 返回 invalid-build，清空该 context 的 session |
| 候选 Raw 无法被 PoB Item 解析 | 返回 invalid-item，不执行槽位计算 |
| 没有合法槽位 | 返回 no-valid-slot，不显示伪差异 |
| Lua 计算异常 | 返回 calculation-failed，保留基础装备 Tooltip |
| 旧 context 响应晚到 | 丢弃并记录 stale-context |
| LuaJIT sidecar 不可用 | 客户端回退 Wasmoon；两者都不可用才返回 runtime-unavailable |
| FullDPS 缺失 | 按 PoB2 规则视为该统计项无差异，不用 0 伪造下降 |
| 条件项只在一侧可见 | 只要 condFunc 任一侧满足就允许显示 |
| 候选是当前槽位装备 | operation 必须是 remove，不是 equip 同一件装备 |
| 同名但不同 Item ID | 按不同装备处理，不能误判为 remove |
| 活跃武器组改变 | 旧槽位结果全部失效并重新枚举 |

Lua 错误信息可以在开发日志中保留原始信息，但用户界面显示稳定的错误类别和简短中文说明，避免把 Lua 堆栈直接放入 Tooltip。

## 10. 测试和验收计划

### 10.1 行为测试

至少覆盖：

1. 空 Ring 1/Ring 2 的多槽位结果。
2. 已穿戴戒指的移除结果。
3. 同名但不同 ID 的传奇戒指不会误判为移除。
4. limit = 1 的唯一装备达到上限后的槽位过滤。
5. 普通装备的同基底排序。
6. 武器、盾牌、弓/箭袋、法杖/Focus、Talisman/Sceptre。
7. Giant's Blood 等条件改变 Weapon 2 合法性的情况。
8. 普通珠宝、Cluster Jewel 尺寸、限制珠宝孔和装备内 Jewel Socket。
9. Flask 的启用/停用差异。
10. Charm 的启用/停用差异。
11. Player + Minion 双输出。
12. condFunc、flag、notFlag 和 lowerIsBetter。
13. pc/mod、compPercent、零值和 0.001 阈值。
14. FullDPS 缺失、SkillDPS 排除和无变化结果。
15. 当前 Tooltip 设置只比较指定槽位。

### 10.2 双后端一致性

使用同一批 XML、候选装备 Raw 和配置，分别在 Wasmoon 与 LuaJIT 执行，比较结构化 JSON：

- 浮点数使用明确容差，例如 1e-6。
- 槽位、operation、统计顺序和颜色必须完全一致。
- 任何差异都记录 backend、bundle hash、contextKey 和输入摘要。

### 10.3 Golden/Parity 测试

建立项目测试用例，把 PoB2 原始 Tooltip collector 的结果与项目结构化 collector 的结果对照。测试重点不是字面颜色码，而是：

- 是否出现相同的统计 key。
- 顺序是否相同。
- delta/percent 是否相同。
- remove/equip/toggle 文案语义是否相同。
- 多槽位排序是否相同。

上游 PoB bundle 更新时必须重新生成 golden 结果并审查差异。

### 10.4 性能验收

在同一构筑下连续比较 1 件装备的多个合法槽位：

- 首次建立 session 计入 base calculation 时间。
- 后续槽位不得重复加载 XML。
- 相同候选再次悬停应命中 candidate cache。
- UI 不得出现旧候选结果覆盖新候选结果。

响应中记录 sessionReused、cacheHit 和耗时，开发环境可输出日志，生产环境只保留必要指标。

## 11. 分阶段实施计划

### 阶段 0：契约和测试夹具

- 定义 EquipmentDifferenceRequest/Result 类型。
- 准备空槽位、移除、传奇限制、珠宝、Flask、Charm、Minion 等 XML/Raw fixture。
- 固定当前 PoB bundle version/hash。

### 阶段 1：Lua 结构化比较桥接

- 实现 session 初始化和 getMiscCalculator 复用。
- 实现普通槽位枚举、已穿戴移除和限定传奇过滤。
- 实现 Flask/Charm toggle。
- 实现 displayStats/minionDisplayStats 结构化差异 collector。
- 实现 PoB2 槽位排序。

### 阶段 2：两种运行时和 IPC

- Wasmoon Worker 增加 compareEquipment。
- LuaJIT sidecar 增加同名请求和 session 生命周期。
- Electron main/preload 增加类型校验和 IPC。
- pobLuaClient 增加后端回退和请求去重。

### 阶段 3：缓存和失效

- 接入构筑 revision、active item set、weapon set 和 config fingerprint。
- 增加 session/candidate LRU。
- 接入 generation、去抖和过期响应丢弃。

### 阶段 4：装备 UI

- 在装备详情 Tooltip 接入结构化差异。
- 支持指定槽位和全部合法槽位两种模式。
- 对齐 PoB2 文案语义、分组、顺序和颜色。
- 增加加载、无差异、无合法槽位和失败状态。

### 阶段 5：验收和回归

- 执行双后端 parity/golden 测试。
- 执行已有构筑、技能 DPS、装备解析和集市装备回归。
- 检查上游 bundle 更新时的版本检测和差异提示。

## 12. 明确不做的事情

- 不在前端根据词缀手算 DPS、EHP、抗性或资源变化。
- 不只返回“最优槽位”，完整模式必须返回所有合法槽位。
- 不把同名装备当作同一对象来判断移除。
- 不把 Flask/Charm 塞进普通装备替换逻辑。
- 不通过 Tooltip 字符串反向解析统计 key 作为正式协议。
- 不把 Lua comparison session 持久化到磁盘。
- 不修改上游 PoB2 的 ItemsTab.lua、Build.lua、Calcs.lua、BuildDisplayStats.lua、Item.lua 或 CalcSetup.lua。

## 13. 最终验收标准

功能达到以下条件才视为“完整还原 PoB2 装备差异统计”：

1. 普通装备没有明确槽位时，返回所有 PoB2 判定为合法且可见的槽位。
2. 候选装备就是当前槽位装备时，显示移除后的差异；不同 Item ID 不会误判。
3. Ring、Weapon、Jewel Socket、Cluster Jewel、Flask、Charm 等特殊规则与 PoB2 一致。
4. 限定传奇过滤和槽位排序与 PoB2 一致。
5. 统计字段、条件、阈值、百分比、颜色方向、Player/Minion 分组和顺序与 PoB2 一致。
6. 差异由 PoB Lua 计算得出，前端不进行独立数值推算。
7. Wasmoon 与 LuaJIT 的结构化结果一致。
8. 构筑不变时多个候选共享比较 session，构筑/配置变化时不会复用旧结果。
9. 快速悬停、并发请求和后端切换不会发生旧结果覆盖新 Tooltip。
10. 上游 PoB bundle 更新可通过版本/hash 和 parity test 发现语义漂移。
