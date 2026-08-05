# SuperPoE2 装备仓库工作台设计

> 状态：方案阶段，暂不实现替换和构筑收益比较
>
> 更新时间：2026-08-04
>
> 关联设计：[`marketplace-browser-design.md`](./marketplace-browser-design.md)、[`price-check-design.md`](./price-check-design.md)、[`pob-build-object-design.md`](./pob-build-object-design.md)

## 1. 目标

SuperPoE2 需要一个独立的装备工作台，用来统一管理不同来源的装备候选：

- 集市收藏的装备
- 从完整 PoB 构筑中导入的装备
- 用户直接粘贴 PoB 物品文本创建的自定义装备
- 装备界面显式收藏的当前装备
- 游戏内查价产生的装备快照

装备仓库是装备候选的管理中心，不是当前构筑的第二份权威数据，也不是交易网页的附属缓存。

```text
市场 / PoB / 自定义 / 装备界面
              |
              v
       EquipmentLibraryRepository
              |
              +-- 装备仓库一级入口
              +-- 交易中心快捷入口
              +-- 构筑装备快捷入口
              +-- 后续替换和比较入口
```

## 2. 核心决策

### 2.1 一个仓库，多个入口

装备仓库只允许存在一个数据源和一套管理界面。

| 进入位置 | 进入目的 | 传入上下文 |
| --- | --- | --- |
| 主导航“装备仓库” | 独立管理全部装备 | 无目标装备 |
| 交易中心 | 查看市场收藏或市场来源 | 来源筛选、联赛、市场上下文 |
| 构筑装备界面 | 将当前装备收藏到仓库或查找候选 | buildId、ItemSet、slotName、当前 Item |
| PoB 导入流程 | 查看新导入的装备 | buildId、pobItemId、来源筛选 |

快捷入口可以带筛选和目标，但不能创建另一套仓库状态。

### 2.1.1 装备仓库与交易中心快捷栏的边界

两者共享同一个主进程仓库服务，但不是同一个工作台：

- 一级“装备仓库”只管理装备条目，包括市场装备快照、PoB 导入装备、装备界面收藏和自定义装备。
- 一级“装备仓库”使用“来源目录 + 固定装备网格 + tooltip”的仓库工作台，不能显示保存的搜索。
- 交易中心里的侧栏定位为“交易中心快捷栏”，用于在浏览市场时快速访问装备收藏和搜索收藏。
- 保存的搜索属于交易中心搜索管理，不属于装备仓库；搜索目录可以继续使用同一持久化服务的 `searches` scope，但不能出现在装备仓库一级页面。
- 两个入口通过同一 `EquipmentLibraryRepository` 读写数据，装备条目和保存的搜索仍然分别使用各自的数据模型。

### 2.2 一级入口不等于默认首页

装备仓库需要一级入口，但不需要成为启动页默认内容。

推荐主导航结构：

```text
我的构筑
装备仓库
交易中心
工具中心
```

“构筑内装备”表示当前构筑正在使用的装备；“装备仓库”表示跨来源、跨构筑管理的候选装备。两者名称和职责必须区分。

### 2.3 仓库主体和来源分离

一件装备是仓库主体，市场 Listing、PoB Item、自定义导入只是来源。

取消一个来源时，只删除对应来源；只要还存在其他来源、标签、目录或备注，就不能静默删除仓库主体。

## 3. 第一阶段范围：装备管理

第一阶段只完成仓库本身，不提前接入复杂的构筑替换和 DPS 计算。

### 3.1 必须支持

- 一级入口打开装备仓库
- 交易中心、装备界面快捷打开同一仓库
- 全部、集市、PoB、自定义来源筛选
- 装备搜索、目录、标签、备注和归档
- 装备格子和 tooltip 中查看内容与全部来源
- 市场来源 URL、价格、联赛和可用状态展示
- PoB 来源的构筑、ItemSet、Item ID 展示
- 自定义 PoB 物品文本导入
- 装备内容去重和多来源合并
- 删除来源确认
- 删除仓库主体确认
- 未完整解析装备的状态提示

### 3.2 第一阶段明确不做

- 不直接修改当前构筑装备
- 不自动替换装备
- 不自动删除构筑中的旧装备
- 不在仓库列表中直接承诺 DPS 提升
- 不把市场结构化快照强行转换成完整 PoB Item
- 不让仓库 Entry ID 充当 PoB Item ID

## 4. 信息架构

装备仓库页面采用“来源目录 + 固定格子 + tooltip”的仓库布局。格子使用 CSS Grid，保持稳定的卡片尺寸和行高，避免装备名称、价格或词条变化造成仓库位置跳动：

```text
+----------------------+-----------------------------------------+
| 仓库目录              | 固定装备格子                            |
|                      |                                         |
| 全部装备              | [装备] [装备] [装备] [装备]             |
| 集市收藏              | [装备] [装备] [装备] [装备]             |
| PoB 导入              | [装备] [装备] [装备] [装备]             |
| 装备界面收藏          |                                         |
| 自定义装备            |                                         |
| 未分类 / 自定义目录   |                                         |
+----------------------+-----------------------------------------+
```

装备格子只显示快速识别信息：

- 装备图标、名称和底材
- 来源分类
- 选中状态和可用操作提示

鼠标悬浮或键盘聚焦格子时，通过 tooltip 显示完整信息：

- 稀有度、Item Level、品质
- 全部词条及其分组
- 全部来源、价格、标签和备注

按住 `Alt` 点击装备格子时，tooltip 转为独立的装备详情悬浮窗。悬浮窗采用装备界面的 PoE 物品标题、稀有度配色、分组词条和 metadata 样式，标题栏支持拖动，右上角提供关闭按钮。

选中装备后的第一阶段操作：

- 编辑备注和标签
- 移动到目录
- 打开来源
- 集市找相似
- 查看原始文本
- 删除来源
- 删除仓库装备

后续再增加：

- 对比当前装备
- 选择目标槽位
- 替换到构筑

## 5. 进入上下文

所有入口都打开同一个仓库数据源，但根据入口职责使用不同的界面实现：一级入口使用 `EquipmentLibraryWorkspace` 网格仓库工作台，交易中心使用 `EquipmentLibraryPanel` 快捷栏。入口只改变初始化上下文，不改变仓库数据规则。

```ts
type EquipmentLibraryOpenContext =
  | { kind: 'standalone' }
  | { kind: 'market'; realm?: MarketRealm; sourceKind?: 'market-favorite' }
  | { kind: 'build-slot'; buildId: string; itemSetId: string; slotName: string; currentItemId?: string }
  | { kind: 'pob-import'; buildId: string; pobItemId?: string }
```

上下文只影响：

- 初始筛选
- 当前目标提示
- 返回位置
- 后续“对比/替换”动作的目标

上下文不能改变仓库数据模型，也不能产生不同的删除、去重或保存规则。

## 6. 数据模型边界

现有 `EquipmentLibraryEntry` 继续作为仓库主体：

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
```

### 6.1 来源语义

- `market-favorite`：市场 Listing 来源，保存 realm、league、listingId、URL、价格和状态。
- `pob-import`：完整 PoB 构筑来源，保存 buildId 和 pobItemId。
- `equipment-favorite`：装备界面显式收藏来源，保存构筑、ItemSet、Item 和槽位。
- `price-check`：游戏内查价来源，保存查价上下文。
- `manual`：第一阶段作为“自定义”来源显示，保留内部兼容性。

第一阶段不急于新增 `custom` 枚举，避免无必要的 schema 迁移；UI 将 `manual` 标记为“自定义”。

### 6.2 装备内容和市场状态分离

`LibraryItemSnapshot` 描述装备内容；价格、卖家、Listing 状态和市场来源只放在 `MarketFavoriteSource`。

价格变化不能改变装备 fingerprint，也不能造成新的仓库装备。

装备下架后：

- 保留装备内容
- 保留历史价格
- 将市场来源标记为 `unavailable`
- 允许用户继续查看和比较

### 6.3 能力状态

装备仓库需要明确区分“能展示什么”和“能执行什么”：

```text
展示能力：能否显示名称、底材、词条和来源
比较能力：能否完成装备本体差异比较
应用能力：能否安全转换为构筑内 PoB Item
计算能力：能否放入临时构筑进行 PoB 计算
```

市场 API 只提供结构化快照但没有完整 PoB 原始文本时，可以进入仓库并参与本体比较，但不能直接承诺可以替换或计算。

## 7. 三种导入流程

### 7.1 市场装备

```text
市场收藏
  -> 主进程校验 Listing
  -> 官方 Fetch 获取结构化装备
  -> 归一化词条和 stat ID
  -> 生成 LibraryItemSnapshot
  -> upsert 到统一仓库
```

网页 DOM 只负责提供 Listing 引用；仓库必须使用主进程校验后的结构化数据。

### 7.2 PoB 构筑装备

```text
完整 PoB 构筑
  -> 读取 Items 中的 Item
  -> 保留原始 item raw 文本
  -> 生成 LibraryItemSnapshot
  -> 写入 pob-import 来源
```

同一件构筑内装备可以同时拥有 `pob-import` 和 `equipment-favorite` 两个来源。

### 7.3 自定义装备

```text
粘贴 PoB 物品文本
  -> 预览解析结果
  -> 显示未识别字段和词条警告
  -> 用户确认
  -> 保存 rawText 和结构化快照
  -> 写入 manual 来源
```

自定义导入必须保留原始文本。无法完整解析的词条可以保存，但必须标记警告，不能在后续替换时静默丢失。

## 8. 去重和身份规则

仓库主体的 fingerprint 只描述装备内容，不包含：

- 价格
- 卖家
- realm
- league
- listingId
- buildId
- ItemSet ID
- PoB Item ID
- Trade Stat ID

跨语言或部分解析的装备不能仅凭展示文本自动合并。后续需要补充稳定底材 ID 和完整内容签名，避免不同结构的装备被误合并。

构筑内 Item ID 和仓库 Entry ID 永远是不同身份：

```text
仓库 Entry ID：管理候选装备
PoB Item ID：构筑内部的可计算物品实体
```

## 9. 当前装备状态

仓库不持久化简单的 `isEquipped` 布尔值。

当前是否装备，应根据当前构筑实时计算：

```text
当前 ItemSet 槽位引用
  -> 构筑内 Item
  -> 内容 fingerprint
  -> 与仓库 Entry fingerprint 比较
```

这样切换 ItemSet、切换武器、替换装备或加载其他构筑后，状态不会残留。

## 10. 后续阶段：比较

### 10.1 装备本体比较

比较当前装备和仓库候选的：

- 底材、稀有度和 Item Level
- Quality、Socket、Rune
- Enchant、Implicit、Explicit
- Prefix/Suffix 和词条等级
- 当前数值及范围
- Corrupted、Mirrored 等状态
- 新增、删除和变化的词条

### 10.2 构筑结果比较

构筑结果比较必须使用临时构筑副本：

```text
当前构筑
  -> fork
  -> 将候选装备应用到目标槽位
  -> PoB Lua 计算
  -> 比较 DPS、防御、生命、抗性和属性
```

比较过程不能修改用户当前构筑。结果不完整时必须显示警告，而不是输出伪精确的提升百分比。

## 11. 后续阶段：替换

替换操作必须明确目标：

```text
目标构筑 / ItemSet / 槽位
```

确认替换后：

1. 从仓库装备创建新的构筑内 Item。
2. 对候选 Item 做槽位兼容性校验。
3. 修改目标 ItemSet 的槽位引用。
4. 保留旧 Item，支持撤销。
5. 替换成功后刷新当前构筑计算。

市场装备如果没有足够的 PoB 原始信息，只允许“比较”，替换按钮必须禁用并说明原因。

## 12. 分阶段交付

### Phase 1：仓库管理

- 一级入口和快捷入口
- 固定网格、tooltip、筛选和来源目录
- 市场、PoB、自定义导入
- 目录、标签、备注、归档
- 来源删除和主体删除确认
- rawText、解析警告和能力状态

### Phase 2：装备本体比较

- 当前装备选择
- 候选装备选择
- 词条差异和数值变化
- Socket、Quality、腐化状态比较
- 无法比较字段的警告

### Phase 3：构筑替换

- 目标构筑、ItemSet、槽位选择
- PoB Item 创建和槽位引用更新
- 槽位合法性校验
- 确认、撤销和旧装备保留

### Phase 4：构筑收益比较

- 临时构筑 fork
- PoB Lua 计算
- DPS、防御、生命、抗性和属性差异
- 配置一致性提示和结果警告

## 13. Phase 1 验收标准

- 从主导航可以直接打开“装备仓库”。
- 从交易中心进入时可以默认筛选市场来源。
- 从装备界面进入时可以保留当前构筑和槽位上下文。
- 市场、PoB、自定义装备进入同一个仓库列表。
- 同一装备的多个来源不会生成重复主体。
- 删除一个来源不会误删其他来源。
- 删除仓库装备必须用户确认。
- 自定义 PoB 文本能够保留原文并显示解析警告。
- 仓库不会改变当前构筑的 ItemSet 或 Item 实体。
- 所有入口最终展示同一份仓库数据。

## 14. 当前实现边界

第一阶段优先复用现有模块：

- `electron/equipmentLibraryRepository.ts`：持久化、来源和去重
- `src/types/market.ts`：仓库和来源类型
- `src/components/market/EquipmentLibraryWorkspace.tsx`：一级装备仓库网格工作台
- `src/components/market/EquipmentLibraryPanel.tsx`：交易中心快捷栏和搜索收藏 UI
- `src/components/EquipmentPanel.tsx`：装备界面快捷入口
- `electron/marketListing.ts`：市场装备校验和归一化

需要新增或调整的主要是：

- 全局装备仓库入口和路由上下文
- 自定义 PoB 物品导入流程
- 装备能力状态和解析警告
- 格子 tooltip 和选中装备操作栏
- 后续的候选装备与构筑 Item Adapter

本方案不改变 PoB2 完整 XML 作为构筑权威数据源的原则。仓库只保存装备候选快照；真正应用到构筑时，必须通过构筑对象和 ItemSet 引用完成。
