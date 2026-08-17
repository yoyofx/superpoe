# SuperPoE2 装备仓库整理与装备选择兼容设计

> 状态：方案设计，暂不实现
>
> 目标：在不破坏现有装备仓库、集市、构筑装备替换和珠宝绑定功能的前提下，增加装备目录整理能力，并让所有装备选择入口复用同一套查询能力。
>
> 关联设计：[`equipment-library-workbench-design.md`](./equipment-library-workbench-design.md)

## 1. 设计结论

装备仓库继续作为统一的数据管理中心，但不同来源保持独立边界。

- `market`：集市收藏和集市快照。
- `build`：构筑导入、构筑装备收藏。
- `custom`：用户粘贴或手动创建的自定义装备。
- 同一来源根内可以自由整理目录。
- 不同来源根之间不能直接移动、合并或自动去重。
- 试穿、差异统计和构筑应用可以读取候选装备，但不会改变候选装备的来源。
- 需要跨来源长期保存时，必须执行明确的“复制/导入”，生成目标来源下的新记录。

这套规则同时满足两个要求：保留当前功能的使用能力，又避免集市、构筑和自定义数据互相污染。

## 2. 范围

### 2.1 本次设计包含

- 装备在同一来源目录内的鼠标拖动移动。
- 单件和多选装备移动。
- 来源根、目录和装备的目标校验。
- 装备仓库、交易中心快捷栏和选择器的共享查询层。
- 装备替换、珠宝绑定、试穿和差异统计的上下文过滤。
- 跨来源候选的临时使用和显式复制/导入规则。
- 旧数据、旧接口和现有交互的兼容方案。

### 2.2 本次设计不包含

- 修改 PoB 上游 Lua 文件。
- 重做现有装备解析、试穿或差异统计算法。
- 自动把集市装备写入当前构筑。
- 自动合并不同来源的同一件装备。
- 目录外的云同步或账号级共享。

## 3. 来源隔离模型

### 3.1 来源根是不变量

`EquipmentLibraryEntry.collectionRoot` 表示装备的管理来源根。装备进入仓库后，普通移动操作不能修改这个字段。

现有来源类型与来源根保持以下映射：

| 来源类型 | 来源根 | 说明 |
| --- | --- | --- |
| `market-favorite` | `market` | 集市收藏的 Listing 和价格证据 |
| `pob-import` | `build` | 从完整构筑导入的装备 |
| `equipment-favorite` | `build` | 构筑装备界面显式收藏 |
| `price-check` | `custom` | 查价产生的装备快照，后续可单独显示来源标签 |
| `manual` | `custom` | 用户粘贴或手动创建的装备 |

同一来源根内，不同来源类型可以附加到同一个仓库主体。例如构筑导入和构筑界面收藏可以指向同一个 `build` 条目。跨来源根时，即使 `fingerprint` 相同，也必须保留为不同条目。

### 3.2 可见、可试穿和可持久化是三种能力

来源隔离不等于所有界面都不能看到其他来源：

| 操作 | 是否可跨来源查看 | 是否改变原条目 | 是否需要复制 |
| --- | --- | --- | --- |
| 独立仓库浏览 | 可以，按来源根分组 | 否 | 否 |
| 装备详情/Tooltip | 可以 | 否 | 否 |
| 试穿/差异统计 | 可以，作为临时候选 | 否 | 否 |
| 当前构筑装备替换 | 按现有入口策略允许 | 否 | 需要持久化到构筑时才复制 |
| 珠宝绑定 | 按珠宝入口策略允许 | 否 | 需要保存为构筑来源时才复制 |
| 拖动到其他来源目录 | 不允许 | 否 | 必须使用复制/导入 |

因此，“市场装备可以试穿”不表示市场目录和构筑目录互通；试穿只创建临时计算输入，不修改仓库来源。

## 4. 数据和目录模型

### 4.1 装备条目

继续使用现有 `EquipmentLibraryEntry`：

```ts
interface EquipmentLibraryEntry {
  schemaVersion: 3
  id: string
  fingerprint: string
  item: CanonicalEquipmentItem
  view: CanonicalItemView
  sources: EquipmentLibrarySource[]
  collectionRoot: 'market' | 'build' | 'custom'
  folderId?: string
  tags: string[]
  note?: string
  archived: boolean
  createdAt: string
  updatedAt: string
}
```

移动装备只修改 `folderId` 和 `updatedAt`。以下字段不能被移动操作修改：

- `id`
- `fingerprint`
- `item`
- `sources`
- `collectionRoot`
- `tags`、`note`、`archived`

### 4.2 目录约束

- 装备目录必须带有 `scope: 'items'` 和 `collectionRoot`。
- 目录只能有同一来源根的父目录。
- 目录不能移动到其他来源根。
- 固定来源根不能重命名或删除。
- 根目录使用 `folderId = undefined` 表示。
- 搜索收藏使用 `scope: 'searches'`，不能作为装备拖放目标。

### 4.3 旧数据处理

加载旧仓库时继续执行现有 schema 迁移。若发现一个旧条目的来源同时属于多个来源根：

1. 按来源根拆分为多个仓库条目。
2. 每个条目保留同一份 canonical item 内容。
3. 每个条目只保留属于自身来源根的 `sources`。
4. 不做跨根 fingerprint 合并。

正常目录移动不需要数据迁移，也不需要修改 PoB 构筑 XML。

## 5. 装备拖动整理

### 5.1 交互对象

拖动源支持：

- 单个装备卡片。
- 批量选择后的多件装备卡片。

拖动目标支持：

- 同一来源根下的目录。
- 同一来源根的根节点。

不支持作为装备目标的对象：

- 其他来源根目录。
- 搜索收藏目录。
- 固定根节点以外的详情区域。
- 已删除或已失效的目录。

### 5.2 拖动流程

```text
按住装备卡片
  -> 生成拖动数据 { entryIds, collectionRoot, sourceFolderIds }
  -> 移入目录或来源根
  -> 前端预校验来源根
  -> 主进程再次校验目标
  -> 原子移动全部条目
  -> 广播 equipmentLibraryChanged
  -> 所有仓库/选择器刷新当前列表
```

拖动卡片主体触发拖动；卡片中的详情、试穿、查价和删除按钮继续保持原有点击行为。批量拖动时，必须在批量选择模式下开始拖动，避免普通点击误移动。

### 5.3 目标状态

| 状态 | 视觉反馈 | 松开后的行为 |
| --- | --- | --- |
| 同根目录 | 高亮目录和放置线 | 移动成功 |
| 同根根节点 | 高亮根节点 | 移到未分类根目录 |
| 不同来源根 | 禁止光标、红色提示 | 拒绝移动，原位置不变 |
| 搜索目录 | 禁止光标 | 拒绝移动 |
| 自身目录或子目录 | 禁止光标 | 拒绝移动，防止目录关系异常 |
| 失效目标 | 取消高亮 | 拒绝移动并刷新目录 |

错误提示应说明原因，例如“不能把集市装备移动到构筑目录；请使用复制到构筑”。

### 5.4 原子性和并发

移动接口一次接收全部装备 ID 和一个目标目录，不按单件循环保存。

- 所有条目必须存在。
- 所有条目必须属于同一来源根。
- 目标目录必须属于同一来源根。
- 任一校验失败时整批回滚，不产生部分移动。
- 保存成功后更新 `updatedAt` 并发送统一变更事件。
- 其他窗口收到事件后重新读取当前目录，不直接假设本地操作成功。

## 6. Repository API 设计

### 6.1 新增移动接口

新增独立的移动接口，避免使用现有 `updateMetadata` 隐式修改来源根：

```ts
interface MoveEquipmentInput {
  entryIds: string[]
  targetFolderId?: string
}

interface MoveEquipmentResult {
  movedIds: string[]
  collectionRoot: EquipmentCollectionRoot
  targetFolderId?: string
}

moveEquipment(input: MoveEquipmentInput): MoveEquipmentResult
```

实现规则：

1. 读取所有条目并确认存在。
2. 确认所有条目的 `collectionRoot` 相同。
3. 校验目标目录的 `scope` 和 `collectionRoot`。
4. 一次性更新所有条目的 `folderId`。
5. 保存文件并返回结果。

`updateMetadata({ collectionRoot })` 后续应限制为显式复制/导入流程使用，普通界面不能通过它跨根移动。

### 6.2 显式跨来源复制

需要把装备从市场或自定义来源纳入构筑时，使用单独的复制接口：

```ts
interface CopyEquipmentToRootInput {
  entryId: string
  targetRoot: EquipmentCollectionRoot
  targetFolderId?: string
}

copyEquipmentToRoot(input: CopyEquipmentToRootInput): EquipmentLibraryEntry
```

复制规则：

- 创建新的仓库条目 ID。
- 保留 canonical item，但不合并原条目。
- 目标条目的 `collectionRoot` 为 `targetRoot`。
- 原条目、来源、目录和市场状态不变。
- 复制操作必须由用户明确触发，并给出来源和目标提示。
- 如目标根已有相同 fingerprint，仍不自动合并；可以提示“已有相同装备”，由用户选择继续或取消。

## 7. 统一查询层

### 7.1 目标

仓库工作台、交易中心快捷栏和装备选择器不能各自调用 `listLibrary` 后重复过滤。新增共享查询层，统一处理：

- 文本搜索。
- 来源根和来源类型。
- 目录。
- 装备类别和槽位兼容性。
- 珠宝类型和珠宝孔上下文。
- 归档状态。
- 当前构筑上下文。

### 7.2 查询上下文

```ts
type EquipmentLibraryQueryContext =
  | { kind: 'workspace'; roots?: EquipmentCollectionRoot[]; includeArchived?: boolean }
  | { kind: 'equipment-slot'; slotName?: string; roots?: EquipmentCollectionRoot[] }
  | { kind: 'jewel-slot'; roots?: EquipmentCollectionRoot[] }
  | { kind: 'try-on'; slotName?: string; roots?: EquipmentCollectionRoot[] }
  | { kind: 'price-check'; roots?: EquipmentCollectionRoot[] }
```

现有选择器的 `mode`、`currentSlot`、`filterEntry` 等属性继续保留；新上下文作为可选参数加入，不改变旧调用方。

### 7.3 选择入口兼容规则

| 入口 | 现有能力 | 统一查询增加的限制 |
| --- | --- | --- |
| `EquipmentPanel` | 选择装备并替换当前槽位 | 按槽位和装备类型过滤，保留来源标签 |
| `JewelSocketPanel` | 选择珠宝并绑定珠宝孔 | 只显示珠宝，并保留范围、污染等信息 |
| `EquipmentLibraryPicker` | 共享仓库中选择装备/珠宝 | 继续支持旧 `mode` 和回调 |
| `EquipmentLibraryWorkspace` | 浏览、详情、试穿、查价 | 支持完整来源筛选和拖动整理 |
| `EquipmentLibraryPanel` | 交易中心快捷访问 | 默认显示集市来源，目录仍与集市收藏一致 |
| 差异统计 | 使用候选装备计算差异 | 只读临时使用，不移动或合并来源 |

选择结果仍返回现有 `EquipmentLibraryEntry`，宿主继续执行原有替换或绑定逻辑。需要跨来源长期保存时，由宿主明确调用复制接口，不在选择器内部偷偷改变来源。

## 8. UI 结构

### 8.1 装备仓库工作台

```text
+------------------+----------------------------------------+
| 来源与目录        | 搜索 / 筛选 / 批量操作                  |
|                  +----------------------------------------+
| 集市收藏          | [装备卡] [装备卡] [装备卡]               |
| 构筑导入          | [装备卡] [装备卡] [装备卡]               |
| 自定义            |                                        |
+------------------+----------------------------------------+
```

来源根使用明确的标题和图标。不同来源根可以使用不同的来源标签，但不使用容易误解为同一目录的连续列表。

装备卡片保留现有详情、试穿、查价和删除按钮。拖动只负责整理目录，不能替代这些操作。

### 8.2 选择器

选择器仍采用当前弹窗和目录树布局：

- 默认打开当前入口允许的来源范围。
- 来源根之间使用分组显示。
- 每张卡片显示来源标签。
- 目录树为只读，选择器不能修改目录。
- 选中后继续使用现有“更换装备”或“绑定珠宝”按钮。
- 禁止的来源只在需要时显示为灰色或不显示，不能让用户误以为可以直接移动。

### 8.3 跨来源使用提示

当候选来源与目标构筑来源不同时：

- 试穿/差异统计：直接作为临时候选，不弹出迁移确认。
- 确认写入构筑或收藏到构筑目录：提示“将复制到构筑来源”，并保留原集市/自定义条目。
- 用户取消时，不修改任何仓库数据。

## 9. 状态、错误和恢复

### 9.1 移动状态

- `idle`：没有拖动。
- `dragging`：拖动源已建立。
- `valid-target`：当前目标可接受。
- `invalid-target`：目标来源不匹配或不可用。
- `moving`：主进程正在提交。
- `success`：刷新列表并显示短暂成功提示。
- `error`：恢复原列表并显示原因。

### 9.2 失败处理

- 目标目录被其他窗口删除：提示目录已失效，重新加载目录树。
- 条目被其他窗口删除：提示部分条目已不存在，整批移动不提交。
- 文件保存失败：保持内存和界面原状态，提示重试。
- IPC 断开：取消拖动提交，不影响已有装备数据。

不使用静默的跨根降级，也不把失败的移动转化为复制。

## 10. 兼容和影响控制

### 10.1 兼容原则

- 保留 `listLibrary`、`updateMetadata`、`EquipmentLibraryPicker` 现有调用方式。
- 新增参数全部为可选参数。
- 旧数据格式继续由现有仓库迁移逻辑读取。
- 旧入口不要求立即改成新页面。
- 选择回调返回值和 PoB canonical item 格式不变。
- 集市当前选中目录继续作为集市收藏的默认目标。

### 10.2 代码边界

建议新增或调整的边界：

| 模块 | 责任 |
| --- | --- |
| `electron/equipmentLibraryRepository.ts` | 移动、复制、来源根校验和原子保存 |
| `src/engine/equipmentLibraryQuery.ts` | 统一查询和场景过滤 |
| `src/types/market.ts` | 查询上下文、移动和复制请求类型 |
| `src/components/market/EquipmentLibraryWorkspace.tsx` | 完整仓库拖动交互 |
| `src/components/market/EquipmentLibraryPanel.tsx` | 集市快捷栏的同根移动支持（如开启） |
| `src/components/equipment/EquipmentLibraryPicker.tsx` | 复用查询层，保留现有选择行为 |
| `src/components/equipment/EquipmentPanel.tsx` | 只提供槽位上下文和原有替换回调 |
| `src/components/JewelSocketPanel.tsx` | 只提供珠宝孔上下文和原有绑定回调 |

PoB Lua、装备解析和差异统计模块不承载仓库来源或目录移动逻辑。

## 11. 测试设计

### 11.1 Repository 单元测试

- 同一来源根移动单件成功。
- 同一来源根批量移动成功且只保存一次。
- 根目录与子目录之间移动成功。
- 跨来源根移动被拒绝。
- 搜索目录作为目标时被拒绝。
- 不存在的装备或目标目录导致整批回滚。
- 移动不改变 `collectionRoot`、`sources`、`fingerprint` 和 canonical item。
- 显式复制生成新 ID，原条目不变。
- 相同 fingerprint 跨根不自动合并。
- 旧数据拆分后目录来源根正确。

### 11.2 查询和选择器测试

- 装备模式继续按 `currentSlot` 过滤。
- 珠宝模式只返回珠宝。
- 来源根过滤不会误显示其他根条目。
- 没有传入新上下文时，现有选择器行为保持一致。
- 试穿候选不会写入或移动仓库条目。
- 写入构筑时只通过显式复制流程改变来源。

### 11.3 UI 测试

- 卡片拖入同根目录显示可放置状态。
- 拖入不同来源根显示禁止状态。
- 批量拖动不产生部分成功。
- 拖动过程中点击详情、试穿、查价按钮不会触发移动。
- 变更事件能让装备仓库和选择器同步刷新。

## 12. 分阶段实施

### Phase 1：来源校验和移动 API

- 新增 `moveEquipment`。
- 限制普通 `updateMetadata` 不得跨根修改。
- 补充 repository 测试。

### Phase 2：装备仓库拖动整理

- 完整仓库支持单件和批量拖动。
- 增加目标高亮、禁止状态、错误提示和变更广播。

### Phase 3：统一查询层接入选择器

- 抽出查询和场景过滤。
- 保留 `EquipmentLibraryPicker` 现有 props 和回调。
- 接入装备替换和珠宝绑定入口。

### Phase 4：显式跨来源复制

- 增加复制/导入动作。
- 在试穿、替换和绑定的持久化路径上提供来源提示。
- 保留原始条目和来源证据。

### Phase 5：装备差异统计集成

- 所有可试穿或选择的 canonical 装备都可以复用独立差异统计模块。
- 装备替换入口按具体装备槽位显示差异；珠宝选择不把珠宝孔节点 ID 当作普通装备槽位。
- 集市、构筑和自定义装备都只作为临时候选参与计算，不改变来源根和当前构筑。
- 差异结果使用当前构筑、ItemSet、武器组和配置上下文；上下文变化后缓存失效。
- 差异计算失败、没有合法槽位或没有可显示统计时，显示明确状态，不影响装备选择本身。

## 13. 验收标准

1. 用户可以用鼠标把装备拖到同一来源根下的任意目录。
2. 不同来源根之间拖动一定失败，且不会修改数据。
3. 批量移动是原子操作，不会出现部分装备移动成功。
4. 移动不会改变装备内容、来源、标签、备注或当前构筑。
5. 所有现有装备选择入口仍能正常打开、筛选、选择和回调。
6. 装备、珠宝、试穿和差异统计使用同一套查询能力，但按场景过滤。
7. 试穿其他来源装备不会合并目录或改变来源。
8. 跨来源长期保存必须经过明确的复制/导入操作。
9. 集市当前目录、旧仓库数据和现有快捷操作保持兼容。
10. 装备替换、珠宝绑定、集市试穿和装备详情都能显示或打开差异统计。
11. 实现过程中不修改任何上游 PoB Lua 文件。
