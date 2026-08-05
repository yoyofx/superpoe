# [已作废] SuperPoE2 M2-M4 BuildDocument 基础架构实施方案

> 状态：已作废，禁止作为实现依据
> 原始日期：2026-08-02
> 作废日期：2026-08-03
> 替代方案：[`pob-build-object-design.md`](./pob-build-object-design.md)
> 实施范围：M2 文件持久化与构筑管理、M3 统一构筑模型与来源同步、M4A 可信计算基础
> 关联文档：`persistent-storage-design.md`、`ROADMAP.md`、`TASKS.md`

> **作废说明：** 本文提出的 `BuildDocument` 唯一权威、分领域 authority 切换以及 `BuildDocument -> PoB2 XML` 重建路线已经在实际实现中被否定。该实现导致技能显示、伤害计算和人物属性计算错误。本文以下所有接口、批次、门禁和实施建议仅保留为历史记录，不得继续实施或被其他文档引用为有效方案。后续以完整 PoB2 XML 对象为统一内存对象，详见替代方案。

## 1. 目标与完成边界

本方案把 M2、M3 和 M4A 作为一条连续的底层改造链路实施。最终形成以下闭环：

```text
PoB Code / WeGame / SuperPoE2 JSON
                  |
                  v
           Import Adapters
                  |
                  v
        BuildDocument（唯一事实来源）
          |       |       |
          |       |       +-- UI 编辑、撤销、草稿、保存
          |       +---------- .bd.json 持久化与传播
          +------------------ PoB Projection
                                    |
                                    v
                         PoB2 XML / Export Code
                                    |
                                    v
                           PobEngineClient 计算
```

基础架构完成包括：

1. 构筑、设置和草稿不再以 renderer `localStorage` 为事实来源。
2. 每个构筑独立保存为 `builds/<uuid>.bd.json`，不依赖永久索引。
3. `BuildDocument` 是构筑唯一事实来源。
4. 天赋、装备、技能和 Config 的界面只读取和修改 `BuildDocument`。
5. PoB Code 只在导入、兼容透传、计算投影和导出边界出现。
6. 计算和导出共用同一个 `BuildDocument -> PoB2 XML` Builder。
7. 引擎状态是可丢弃的派生状态，引擎崩溃后能从 `BuildDocument` 重建。
8. 真实构筑通过导入往返、PoB2 载入和计算 parity 验证。
9. 构筑目录、来源身份和同步基线与文件 Repository 一次完成，不再建立过渡 localStorage workspace。
10. Provider 更新只生成候选 BuildDocument 和差异预览，未经用户确认不得覆盖或创建构筑。

本方案中的 M4 只包含 M4A 可信计算基础。技能推荐、完整伤害/防御解释、复杂增益产品 UI 属于 M4B，不阻塞本基础架构完成。

## 2. 不可违反的架构规则

### 2.1 唯一权威

`BuildDocument` 是唯一事实来源。以下内容都不是权威数据：

- `importedBuildCode` 或生成后的 PoB Code。
- PoB2 XML。
- Lua/Worker 内部构筑实例。
- 计算结果与计算缓存。
- 仓库中的 `LibraryItemSnapshot`。
- 构筑中心的 `BuildSummary`。

任何业务页面不得为了展示装备或技能而再次解码原始 PoB Code。

### 2.2 Adapter 边界

不同领域必须通过明确 Adapter 交互：

```text
PoB Code         <-> PobImportAdapter / PobExportAdapter <-> BuildDocument
仓库装备          -> LibraryItemToBuildItemAdapter         -> BuildEquipmentItem
市场候选          -> TradeListingToBuildItemAdapter        -> BuildEquipmentItem
游戏规划器        <-> PlannerAdapter                        <-> BuildDocument
BuildDocument     -> PobProjection                          -> PoB2 XML
BuildDocument     -> BuildSummaryProjector                  -> BuildSummary
Provider snapshot -> BuildProviderAdapter / PobImportAdapter -> Candidate BuildDocument
```

禁止把仓库模型、官方 Trade API 模型或 PoB XML AST 直接作为构筑领域模型。

### 2.3 原始数据保留

无法识别的 PoB XML 字段不能静默丢弃。导入时保留原始 Code 和必要 passthrough，生成 XML 时把未被结构化模型接管的内容合并回去。

### 2.4 分阶段切换 authority

迁移期间允许按领域切换 authority，但任一领域同一时刻只能有一个权威来源：

```ts
interface BuildAuthority {
  tree: 'structured'
  items: 'pob-code' | 'structured'
  skills: 'pob-code' | 'structured'
  config: 'structured'
}
```

当 `items` 或 `skills` 尚未通过往返和 parity 门禁时，继续从 PoB passthrough 生成对应 XML 段。通过门禁后一次性切换为 `structured`，不能混合两份内容。

### 2.5 BD 更新必须由用户发起

任何会改变 BuildDocument 业务语义的操作都必须来自用户在界面中的明确操作，包括：

- 编辑天赋、装备、技能、Config、名称、标签或备注。
- 从仓库替换或加入构筑装备。
- 重新导入并覆盖当前构筑。
- 应用 Provider 新版本到当前构筑。
- 根据候选版本创建新的构筑副本。

应用启动、Provider 检查、远端版本发现、定时任务、网络响应和后台服务均不得自动修改 BD，也不得自动创建构筑副本。Provider 只能更新独立的检查状态并生成候选 BuildDocument；只有用户查看预览并明确选择“更新当前”或“创建副本”后，才允许调用 BuildRepository 写入。

以下行为不属于自动更新 BD：

- 自动草稿只是保存用户已经完成的编辑，不产生新的业务修改。
- schema migration 只做经过测试的等价格式迁移，不得改变构筑语义。
- 计算结果和引擎缓存是派生数据，不写回 BuildDocument。
- 扫描发现用户在文件系统中手工移动或复制的文件，只更新内存视图；重复 ID 仍需用户处理冲突。

## 3. 当前实现基线

当前需要逐步替换的行为：

- 命名构筑整体保存在 `localStorage['pob2-saved-builds']`。
- 当前临时导入 Code 保存在 `localStorage['pob2-imported-build']`。
- `SavedBuild.importedBuildCode` 同时承担原始档案和运行时数据源。
- 装备页和技能页分别解码同一 PoB Code。
- 加载构筑时仍从 Code 恢复部分职业、等级和武器组信息。
- 计算路径直接消费导入或局部重写后的 XML/Code。
- 仓库 `LibraryItemSnapshot` 面向展示和交易，不足以无损表达构筑装备。

现有可复用能力：

- PoB Code 解码、编码和 XML Tree 段往返。
- PoB Items、ItemSet、Skills 和 Config 的现有解析逻辑。
- LuaJIT sidecar 与 Wasmoon fallback。
- 仓库和机会 Repository 的临时文件、备份和替换写入经验。
- 统一导入 UI、构筑中心和未保存状态基础。

## 4. 目标领域模型

### 4.1 文件信封

```ts
interface StorageEnvelope<T> {
  schemaVersion: number
  revision: number
  writtenAt: string
  writtenBy: {
    appVersion: string
    channel: 'dev' | 'release'
    platform: 'win32' | 'darwin'
  }
  payloadHash: string
  data: T
}
```

`schemaVersion` 是领域数据版本；应用版本不能代替 schema。高于当前支持版本的文件只能只读，禁止用旧结构覆盖。

### 4.2 BuildDocument

```ts
interface BuildDocument {
  id: string
  metadata: BuildMetadata
  game: BuildGameContext
  authority: BuildAuthority
  tree: BuildTree
  equipment: BuildEquipment
  skills: BuildSkills
  config: BuildConfig
  notes: BuildNotes
  interop: BuildInterop
}
```

建议首版字段边界：

```ts
interface BuildMetadata {
  name: string
  description?: string
  tags: string[]
  source: BuildSourceBinding
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

interface BuildGameContext {
  realm: 'cn' | 'global'
  treeVersion: string
  characterClassId: string
  ascendancyId: string
  characterLevel: number
}

interface BuildInterop {
  pob?: {
    originalCode?: string
    originalFormatVersion?: string
    importedAt?: string
    passthrough?: PobPassthrough
  }
}

type BuildProvider = 'wegame' | 'poe.ninja'
type BuildStaticSource = 'pob-code' | 'json' | 'local'

interface BuildSourceBinding {
  kind: BuildProvider | BuildStaticSource
  realm: 'cn' | 'global'
  url: string | null
  sourceId: string | null
  sourceKey: string | null
  appliedRemoteFingerprint: string | null
  syncedContentHash: string | null
  lastSyncedAt: string | null
}
```

`originalCode` 是导入档案与兼容证据，不允许页面把它当作当前装备或技能状态读取。

来源字段规则：

- `sourceKey` 使用 Provider、区服、赛季和稳定外部 ID 规范化生成；URL 不能单独充当所有 Provider 的稳定 ID。
- `appliedRemoteFingerprint` 表示当前构筑实际应用的远端版本，不表示最近检查到的版本。
- `syncedContentHash` 是完成同步时构筑业务内容的规范化 hash，用于判断同步后是否有本地修改。
- 纯 PoB Code、JSON 和本地构筑属于静态来源；没有来源 URL 时不能猜测为 poe.ninja 或其他 Provider。
- 构筑名称、目录、标签、备注、时间、内部 UUID 和 UI 状态不参与内容 hash。

### 4.3 构筑装备模型

构筑装备必须完整表达计算和导出所需数据，不能复用仓库快照：

```ts
interface BuildEquipment {
  activeItemSetId: string | null
  sets: BuildEquipmentSet[]
  items: Record<string, BuildEquipmentItem>
}

interface BuildEquipmentSet {
  id: string
  title: string
  slots: BuildEquipmentSlot[]
}

interface BuildEquipmentSlot {
  slot: string
  itemId: string | null
  weaponSet?: 1 | 2
}

interface BuildEquipmentItem {
  id: string
  rarity: string
  name: string
  baseType: string
  properties: BuildItemProperty[]
  requirements: BuildItemProperty[]
  modifiers: BuildItemModifier[]
  sockets: BuildSocket[]
  raw?: PobItemPassthrough
  libraryReference?: {
    entryId: string
    fingerprintAtImport: string
  }
}
```

仓库装备进入构筑时复制完整快照。构筑随后独立编辑；仓库删除或更新不得静默改变已有构筑。

嵌入物和 `Bonded` 从仓库交易快照清理的规则不能应用到构筑装备。构筑模型必须保留计算与 PoB 导出需要的完整数据。

### 4.4 BuildSummary

构筑中心只消费内存摘要：

```ts
interface BuildSummary {
  id: string
  name: string
  realm: 'cn' | 'global'
  treeVersion: string
  characterClassId: string
  ascendancyId: string
  characterLevel: number
  source: string
  sourceKey: string | null
  folder: string | null
  syncState: 'static' | 'current' | 'update-available' | 'locally-modified' | 'conflict' | 'unavailable'
  itemCount: number
  skillCount: number
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}
```

不保存永久 `builds/index.json`。启动时扫描根目录和一级物理目录中的 `.bd.json`，生成内存摘要和 `buildId -> filePath` 映射。只有性能数据证明扫描成为瓶颈时，才允许增加可删除缓存，缓存不能成为事实来源。

### 4.5 构筑目录与本机工作区元数据

目录直接使用物理文件系统表达，不增加 `folders.v1.json`、folder ID 或 placement 映射：

```text
builds/
├─ <build-id>.bd.json                 # 默认目录
├─ 开荒/
│  ├─ <build-id>.bd.json
│  └─ <build-id>.bd.json
├─ 终局/
│  └─ <build-id>.bd.json
└─ 测试构筑/
   └─ <build-id>.bd.json
```

文件所在路径就是目录归属：根目录中的构筑属于“默认”，一级子目录名称就是用户看到的目录名称。系统视图“全部构筑、最近更新、Provider 构筑、静态构筑”通过查询生成，不对应物理目录。

扫描范围固定为：

```text
builds/*.bd.json
builds/*/*.bd.json
```

只扫描普通文件和一级普通目录，不跟随符号链接、junction 或其他 reparse point，不递归更深目录。构筑文件内部 UUID 仍是稳定身份；路径和目录名不是构筑主键。扫描发现重复构筑 ID 时进入冲突恢复，不能按扫描顺序覆盖。

目录名允许使用经过验证的用户名称，但必须拒绝 Windows 非法字符、尾随空格/点、保留设备名、空名称、`.`、`..`、路径分隔符、绝对路径和超长路径。目录重名按当前平台的文件系统语义处理；Windows 上按大小写不敏感检查，纯大小写重命名使用受控临时名称过渡。

目录操作直接映射为文件系统操作：

- 新建目录：在 `builds/` 下创建一级物理目录。
- 重命名目录：原子重命名物理目录，冲突时不覆盖目标。
- 移动构筑：在同一 userData 文件系统内移动 `.bd.json`；移动成功后更新内存 `buildId -> filePath`。
- 删除目录：先把目录内全部 `.bd.json` 移回 `builds/`，全部成功且目录为空后才删除目录。
- 外部创建目录、复制或移动 `.bd.json`：下一次扫描自动识别。

删除目录是多文件操作，若中途退出，构筑可能一部分在根目录、一部分仍在原目录，但不能丢失；下次扫描必须恢复出全部构筑并允许用户继续删除操作。目标路径存在同名文件时停止并进入冲突处理，禁止覆盖。

纯物理目录不表达目录颜色和任意手动排序，因此首期不提供这两个属性。目录按名称排序；构筑列表支持名称、更新时间、版本和来源排序。拖拽只用于把构筑移动到另一个目录，不表示任意列表顺序。

### 4.6 Provider 运行状态

远端最近检查结果不写入 BuildDocument，独立保存在可恢复状态文件：

```text
builds/provider-state.v1.json
```

```ts
interface ProviderCheckState {
  sourceKey: string
  checkedAt: string
  latestRemoteFingerprint: string | null
  status: 'current' | 'update-available' | 'unavailable' | 'error'
  errorCode?: string
  cachedSnapshotExpiresAt?: string
}
```

判断规则：

```text
有远端更新 = latestRemoteFingerprint != appliedRemoteFingerprint
有本地修改 = currentContentHash != syncedContentHash
```

检查远端不能增加构筑 revision、触发构筑未保存状态或制造构筑备份。Provider 状态丢失只导致需要重新检查，不影响构筑内容。

### 4.7 Provider Adapter

Provider 只负责规范化来源和获取远端快照，不得直接写 Repository：

```ts
interface BuildProviderAdapter {
  readonly kind: BuildProvider
  canHandle(source: BuildSourceBinding): boolean
  normalizeSource(input: string, realm: 'cn' | 'global'): NormalizedBuildSource
  fetchLatest(source: NormalizedBuildSource): Promise<ProviderBuildSnapshot>
  openSource?(source: NormalizedBuildSource): Promise<void> | void
}

interface ProviderBuildSnapshot {
  source: NormalizedBuildSource
  fetchedAt: string
  fingerprint: string
  pobCode: string
  name?: string
  author?: string
  league?: string
}
```

首期 Provider 为 WeGame 和 poe.ninja。WeGame 复用现有 PoE2DB 转换能力；poe.ninja 必须先明确支持的 URL/外部 ID 和稳定版本语义。Provider 错误至少区分不可访问、登录失效、赛季失效、构筑不存在、限流、内容无法解析和版本不兼容。

首期只支持用户手动检查，不在应用启动时批量请求 Provider。定时检查必须另行增加全局开关、频率限制、缓存和暂停状态。

即使未来允许定时检查，也只能更新 ProviderStateRepository 和“有新版本”提示，不能自动应用远端版本、覆盖本地 BD 或创建副本。

### 4.8 构筑中心布局与现有展示兼容

构筑中心固定采用左侧物理目录、右侧构筑列表的工作区结构：

```text
┌──────────────┬─────────────────────────────────────┐
│ 全部构筑     │ 搜索 / 来源 / 区服 / 版本筛选       │
│ 默认         ├─────────────────────────────────────┤
│ 开荒         │ BuildSummary 卡片或列表             │
│ 终局         │                                     │
│ 测试构筑     │ 名称、职业、升华、等级、版本等      │
└──────────────┴─────────────────────────────────────┘
```

左侧规则：

- “全部构筑”是系统视图，聚合根目录和全部一级物理目录。
- “默认”对应 `builds/` 根目录。
- 其他条目直接对应 `builds/<目录名>/`，不使用逻辑 folder ID。
- 最近更新、Provider、静态来源属于右侧筛选条件，不伪装成物理目录。
- 支持新建、重命名和删除目录；删除前把其中构筑移动回“默认”。
- BD 卡片可以拖到左侧目录，成功后底层移动对应 `.bd.json`；文件移动失败时 UI 必须回滚位置。

右侧只消费内存 `BuildSummary`，不得为渲染卡片重新解码 `originalCode`。迁移后必须兼容当前构筑中心已经展示和使用的信息：

| 当前 `SavedBuild` 字段 | `BuildDocument` / `BuildSummary` 来源 |
| --- | --- |
| `id` | `BuildDocument.id` |
| `name` | `metadata.name` |
| `realm` | `game.realm` |
| `treeVersion` | `game.treeVersion` |
| `selectedClassId` | `game.characterClassId` |
| `selectedAscendancyId` | `game.ascendancyId` |
| `characterLevel` | `game.characterLevel` |
| `source/sourceUrl` | `metadata.source` |
| `createdAt/updatedAt` | `metadata.createdAt/updatedAt` |
| `importedBuildCode` | `interop.pob.originalCode`，仅作互操作档案 |

构筑卡片至少继续显示名称、职业、升华、角色等级、天赋树版本、区服、来源和更新时间，并保留打开、删除、导入和导出入口。职业与升华显示名称通过现有 tree/i18n 数据按 ID 解析，不在构筑文件中冗余保存本地化文案。

装备数、技能数和 Provider 同步状态作为 BuildSummary 派生字段补充展示。旧构筑缺少等级、职业或统计字段时，只允许在首次迁移/导入阶段从原始 PoB Code 推导一次并写入 BuildDocument；正常启动扫描和构筑中心渲染不重复解码 Code。

## 5. M2：文件持久化基础

### 5.1 M2A 原子文件组件

先实现与业务无关的主进程基础设施：

- `AtomicJsonFile<T>`：临时文件、flush、读回校验、备份、原子替换。
- `SchemaMigrator<T>`：逐级纯函数迁移和 future-schema 拒绝写入。
- `RepositoryHealth`：正常、只读、已恢复、损坏、冲突状态。
- `UserDataWriteLock`：dev/release 共用目录时只允许一个可写实例。
- 测试目录约束：自动化测试必须使用临时 `SUPERPOE_USER_DATA`。

任何业务迁移开始前，以上组件必须通过文件系统失败测试。

### 5.2 BuildRepository

主进程实现：

```ts
interface BuildRepository {
  scan(): Promise<BuildSummary[]>
  listFolders(): Promise<string[]>
  createFolder(name: string): Promise<void>
  renameFolder(currentName: string, nextName: string): Promise<void>
  removeFolder(name: string): Promise<void>
  moveToFolder(id: string, folder: string | null): Promise<BuildSummary>
  get(id: string): Promise<VersionedBuildDocument>
  create(document: BuildDocument): Promise<VersionedBuildDocument>
  save(id: string, document: BuildDocument, expectedRevision: number): Promise<VersionedBuildDocument>
  duplicate(id: string, name: string): Promise<VersionedBuildDocument>
  rename(id: string, name: string, expectedRevision: number): Promise<VersionedBuildDocument>
  remove(id: string): Promise<void>
  health(): RepositoryHealth
}
```

renderer 只能通过受限 IPC 使用 Repository，不接收绝对路径，不直接写文件。所有目录参数都是单段逻辑名称，由主进程校验并解析到 `builds/` 内；renderer 不能传入相对路径或绝对路径。

同时实现独立 `ProviderStateRepository`。它与 BuildRepository 共用原子文件、schema、health 和写锁，但事务边界不同：Provider 检查失败不能改变构筑或物理目录。

### 5.3 localStorage 首次迁移

迁移必须是可重试事务：

1. 主进程检查 migration marker。
2. renderer 只读取允许的 legacy keys。
3. 主进程限制大小并验证数据。
4. 原始字节备份到 `backups/migrations/`。
5. 每个旧 `SavedBuild` 转换为兼容阶段的 BuildDocument，并迁移 `source/sourceUrl` 为 BuildSourceBinding。
6. 所有旧构筑写入 `builds/` 根目录，作为“默认”目录。
7. 分别写入并读回所有 `.bd.json`。
8. 重新扫描并核对数量、ID、来源、物理路径和核心字段。
9. 全部成功后才写 migration marker。
10. 第一阶段不删除旧 localStorage，只停止读取和写入。

中途失败不得写完成标记，不得以空列表覆盖旧数据。

### 5.4 草稿与未保存状态

- 正式构筑：`builds/<uuid>.bd.json`。
- 草稿：`drafts/<build-id-or-session-id>.json`。
- 草稿携带 `baseRevision`、dirty reason 和 draftedAt。
- 保存使用 `expectedRevision` 做乐观并发检查。
- 关闭窗口、覆盖导入、切换版本、返回构筑中心统一走同一未保存决策。
- 异常退出后显示恢复入口，不静默覆盖正式构筑。

### 5.5 M2 门禁

未满足以下条件不得开始把业务页面切换到新 Repository：

- 原子替换失败不会损坏正式文件。
- 正式文件损坏可从备份恢复。
- future-schema 文件不会被旧版本写回。
- dev/release 不能同时写共享目录。
- legacy 迁移中断可安全重试。
- 直接放入 `.bd.json` 后启动扫描可发现。
- 单个损坏构筑不影响其他构筑列表。
- 外部创建、重命名目录或移动构筑后重新扫描结果正确。
- 删除目录中途退出不会丢失构筑。
- Provider 状态写入不会修改 BuildDocument revision。

## 6. M3：统一 BuildDocument

### 6.1 Import Adapter

实现单次解析入口：

```ts
interface PobImportResult {
  document: BuildDocument
  diagnostics: ImportDiagnostic[]
}

function importPobCode(code: string): PobImportResult
```

导入过程一次性解析 Tree、Items、ItemSet、Skills、Config、Notes、版本和未知字段。装备页、技能页、计算页不得各自再次解码。

WeGame 先转换为 PoB Code，再走相同 Import Adapter。SuperPoE2 JSON 直接验证和迁移为 BuildDocument，不绕回 PoB Code。

Import Adapter 接收可选的规范化来源上下文。只有 Provider URL/ID 经对应 Adapter 验证后才能生成 Provider `sourceKey`；只粘贴 PoB Code 时始终标记为静态 `pob-code`。

### 6.2 Store 切换

Zustand 可继续作为 UI 状态容器，但构筑业务状态必须收敛为：

```ts
interface ActiveBuildState {
  document: BuildDocument | null
  persistedRevision: number | null
  dirty: boolean
  dirtyReasons: BuildDirtyReason[]
}
```

旧的散落字段应通过 selector 和 command 逐步迁移。迁移期间允许兼容 selector，但不允许反向把旧字段作为第二权威源。

所有修改通过领域 command：

- `allocateNode` / `unallocateNode`
- `replaceEquipmentSlot` / `updateEquipmentItem`
- `addSkillGroup` / `updateGem`
- `setConfigValue`
- `updateMetadata`

command 同时负责校验、dirty reason、撤销记录和计算失效标记。

### 6.3 PoB Projection 与 Export

实现唯一 Builder：

```ts
interface PobProjectionResult {
  xml: string
  diagnostics: ProjectionDiagnostic[]
  inputHash: string
}

function buildPobXml(document: BuildDocument): PobProjectionResult
function encodePobCode(document: BuildDocument): string
```

计算和导出必须共用 `buildPobXml()`。禁止维护一套计算 XML 和另一套导出 XML。

Builder 规则：

- 按 authority 选择结构化段或 passthrough 段。
- 生成稳定 Item ID、ItemSet ID、SkillSet ID 和引用。
- 未编辑且未结构化接管的未知字段原样透传。
- 已被结构化模型接管的字段由模型生成，不能再从原始 XML 覆盖回来。
- 输出前进行引用完整性和必需字段校验。
- 同一 BuildDocument 应生成语义稳定的 XML，避免无意义 ID 抖动。

### 6.4 仓库 Adapter

定义单向复制接口：

```ts
function libraryItemToBuildItem(
  item: LibraryItemSnapshot,
  context: BuildItemImportContext,
): BuildItemImportResult
```

Adapter 必须处理：

- 底材和词缀解析状态。
- 目标槽位兼容性。
- 构筑 realm 与来源 realm 差异。
- 缺失的计算字段和无法识别词缀诊断。
- 新构筑 item ID。
- `libraryReference` 仅用于追踪，不作为外键依赖。

构筑装备保存原始观察、结构化值和必要 PoB 表达；仓库的目录、标签、价格、listing ID 和收藏来源不能进入构筑计算模型。

### 6.5 来源更新编排

手动检查更新流程：

1. 根据 BuildDocument 的 `sourceKey` 找到 Provider Adapter。
2. 获取远端 `ProviderBuildSnapshot`，把检查结果写入 ProviderStateRepository。
3. 远端 Code 走同一个 PobImportAdapter，生成候选 BuildDocument。
4. 计算远端版本 fingerprint、候选内容 hash 和当前内容 hash。
5. 相同则显示“已是最新”；不同则生成领域差异预览。
6. 用户选择“更新当前构筑、创建新副本或取消”。
7. 只有确认后才调用 BuildRepository 原子保存。

“更新当前构筑”和“创建新副本”必须是用户点击的显式命令，不能由默认倒计时、关闭弹窗、应用启动恢复或后台策略代替确认。

更新当前构筑时保留本地构筑 ID、名称、当前物理目录、标签、备注和本地 UI 元数据。远端 Tree、Items、Skills、PoB Config 与 passthrough 使用候选内容；本地计算方案和固定比较基线继续保留。若当前内容 hash 与 `syncedContentHash` 不同，预览必须明确提示存在本地修改并二次确认。

首期不做字段级自动合并。检测到本地修改时只允许覆盖当前、创建副本或取消。任何检查都不能静默覆盖，也不能静默创建副本。

重复规则：

- 同一 `sourceKey + remoteFingerprint` 已存在时提示打开现有构筑或显式创建副本。
- 同一来源的新版本显示更新选择。
- 不同来源即使内容相同也允许独立保存。
- 静态 PoB Code 不参与 Provider 去重。
- 创建副本生成新本地 ID，可以保留同一 Provider 来源绑定。

构筑中心左侧显示目录，右侧显示构筑列表；支持当前目录/全部目录搜索、名称/版本/来源筛选。Provider 构筑显示来源与同步状态，静态构筑不显示“检查更新”。

### 6.6 authority 切换门禁

装备 authority 切换为 `structured` 前必须通过：

- 多装备组和武器组导入。
- 所有装备槽位引用完整。
- 唯一、稀有、魔法、普通、珠宝和无装备槽物品往返。
- Rune、Soul Core、Idol、嵌入物和特殊词缀往返。
- 原始 Code 与重新生成 XML 的关键计算结果一致。
- 原版 PoB2 可以载入导出 Code。

技能 authority 使用同类门禁，覆盖技能组、变体、等级、品质、启用状态、主技能和辅助技能关系。

### 6.7 M3 完成标准

- 页面不再直接读取 `importedBuildCode`。
- 完整构筑只解析一次。
- 天赋、装备、技能和 Config 编辑都修改 BuildDocument。
- 保存、草稿、撤销和未保存状态基于 BuildDocument。
- 计算和导出共用 XML Builder。
- 导出的 Code 可被原版 PoB2 打开。
- 未编辑数据和未知字段没有静默丢失。
- 目录、来源身份和同步基线经过同一次首次迁移并可恢复。
- Provider 检查只生成候选和预览，用户确认前不修改构筑。
- 所有 BD 业务更新都能追溯到一次明确的用户命令。

## 7. M4A：可信计算基础

### 7.1 PobEngineClient

定义稳定 API：

```ts
interface PobEngineClient {
  initialize(): Promise<void>
  load(document: BuildDocument): Promise<EngineBuildHandle>
  update(handle: EngineBuildHandle, patch: BuildPatch): Promise<void>
  calculate(handle: EngineBuildHandle, request: CalculationRequest): Promise<CalculationResult>
  rebuild(handle: EngineBuildHandle, document: BuildDocument): Promise<void>
  dispose(handle: EngineBuildHandle): Promise<void>
}
```

首版可以每次 dirty 后重新生成 XML 并 reload，以正确性优先。只有 profiling 证明 reload 成为瓶颈后，再实现 Tree、Items、Skills、Config 增量 patch。

### 7.2 权威与派生状态

- BuildDocument 永远是权威。
- Engine handle、Lua state 和 Worker state 都是可丢弃派生状态。
- 每次计算记录 `documentRevision`、`projectionHash` 和 `engineVersion`。
- 结果只有在 revision 和 hash 仍匹配时才能展示为当前结果。
- 引擎崩溃、超时或版本变化后从 BuildDocument 完整 rebuild。

### 7.3 计算失效规则

以下修改必须使相关结果失效：

- Tree、职业、升华、等级或武器组变化。
- 装备、槽位、装备组或嵌入物变化。
- 技能、辅助、等级、品质、变体或启用状态变化。
- Config 与敌人条件变化。

只修改名称、标签、描述和目录不应触发重新计算。

### 7.4 Parity 测试

每个 fixture 保存：

- 原始 PoB Code。
- 导入后的 BuildDocument fixture 或稳定 hash。
- BuildDocument 生成的 XML/Code。
- 原始 Code 计算结果。
- 生成 XML 计算结果。
- 原版 PoB2 关键指标基线。

覆盖至少包括：

- 不同职业和升华。
- 武器组 I/II。
- 属性节点和 Mastery。
- 多装备组、珠宝和嵌入物。
- 多技能组和主技能选择。
- 召唤物、持续伤害和触发技能。
- 常用 Config 与敌人状态。

整数和枚举字段必须完全一致；浮点字段使用逐指标明确容差，不允许一个全局宽松容差。

### 7.5 M4A 完成标准

- 任一已保存 BuildDocument 可独立生成完整 PoB2 XML。
- LuaJIT sidecar 和 Wasmoon fallback 使用同一 projection 输入。
- 引擎状态丢失后可从 BuildDocument 恢复。
- 编辑装备、技能、天赋或 Config 后计算使用新状态。
- 旧导入 Code 与新生成 XML 的约定关键指标通过 parity。
- 计算错误能区分导入、投影、引擎、超时和结果解析阶段。

## 8. 实施批次与提交边界

每个批次独立提交并通过门禁，不做一个横跨全部模块的大提交。

### Batch 1：存储基础

- AtomicJsonFile、schema migration、health、future-schema 保护。
- userData 写锁和临时测试目录。
- 文件系统单元测试。

### Batch 2：BuildDocument schema

- 新类型、BuildSourceBinding、验证器、fixture 和纯数据 migration。
- 旧 SavedBuild 到兼容 BuildDocument 的转换。
- 暂不切换 UI。

### Batch 3：BuildRepository、物理目录与 IPC

- `.bd.json` 扫描、摘要、CRUD、revision 冲突。
- 根目录与一级物理目录扫描、目录 CRUD 和构筑文件移动。
- 目录名、路径边界、符号链接和重复构筑 ID 防护。
- `provider-state.v1.json` 与构筑 revision 隔离。
- preload 类型安全桥接。
- 构筑中心改用异步摘要。

### Batch 4：legacy 首次迁移与草稿

- localStorage 受限迁移。
- 旧 source/sourceUrl 同批迁移，旧构筑写入物理“默认”根目录。
- 原始备份、marker、重试和恢复。
- 自动草稿与统一未保存处理。

### Batch 5：PoB Import Adapter

- 单次 XML 解析到 BuildDocument。
- 静态来源和经过验证的 Provider 来源上下文。
- Tree、Items、Skills、Config、Notes 和 passthrough fixture。
- 保持旧页面兼容，不切换 authority。

### Batch 6：PoB Projection

- BuildDocument 到 XML 和 Code。
- 引用校验、稳定 ID、未知字段透传。
- 原版 PoB2 载入 smoke test。

### Batch 7：页面与 Store 切换

- ActiveBuildState 和领域 command。
- 装备、技能、天赋和 Config selector。
- 构筑中心物理目录侧栏、拖拽移动、来源和同步状态。
- 右侧 BuildSummary 卡片保持当前名称、职业、升华、等级、版本、区服、来源、时间和操作能力。
- 移除产品路径中的重复 Code 解码。

### Batch 8：装备与技能 authority

- 分别通过往返/parity 门禁后切换为 structured。
- 仓库到构筑 Adapter。
- 装备和技能基础编辑。

### Batch 9：来源更新编排

- Provider Adapter 接口和 ProviderStateRepository。
- Provider 快照通过 PobImportAdapter 生成候选 BuildDocument。
- 更新差异预览、覆盖当前、创建副本和本地修改保护。
- 接入已有 WeGame 转换；poe.ninja Adapter 可在接口稳定后独立交付。

### Batch 10：PobEngineClient

- projection 驱动计算、revision/hash 校验和崩溃重建。
- LuaJIT/Wasmoon 同输入。
- 代表性 parity fixtures。

### Batch 11：清理与验收

- 停止业务 localStorage 双写。
- 删除页面直接解析 `importedBuildCode` 的路径。
- 桌面端真实迁移、恢复、导出和计算 smoke test。
- 更新 ROADMAP/TASKS 状态和架构文档。

## 9. 测试矩阵

### 9.1 存储

- 空目录、正常文件、损坏文件、future schema。
- 写入中断、无权限、磁盘不足、文件占用。
- revision 冲突、备份恢复、残留临时文件。
- dev/release 共用目录竞争。
- 迁移中断和重复启动。

### 9.2 BuildDocument

- 每个 schema 的合法、边界和非法 fixture。
- 逐级迁移及幂等性。
- SavedBuild 兼容转换。
- JSON 导出导入和 ID 冲突。
- 单文件传播后独立打开、计算和导出。

### 9.3 PoB 往返

```text
Code A -> BuildDocument -> XML B -> Code B -> BuildDocument B
```

比较语义而不是压缩字节：Tree、Items、ItemSet、Slots、Skills、Config、Notes、引用和未知字段保留情况。

### 9.4 计算

- Code A 直接计算与 XML B 计算的关键指标 parity。
- 每类编辑后 projection hash 变化且结果刷新。
- 纯 metadata 编辑不触发计算。
- stale result 不覆盖新 revision。
- sidecar 崩溃后 rebuild。

### 9.5 仓库互通

- 仓库装备复制进构筑后独立存在。
- 删除或修改仓库不影响构筑。
- 构筑装备修改不反向污染仓库。
- 不同 realm、未解析词缀和缺失字段给出明确诊断。
- 构筑完整保留嵌入物和 Bonded；仓库交易清理规则保持独立。

### 9.6 目录与来源同步

- 物理目录新建、重命名、扫描、移动和删除。
- 删除目录后构筑进入默认根目录且文件内容不丢失。
- 外部创建目录、复制或移动构筑后重新扫描正确。
- 非法目录名、路径穿越、符号链接和同名目标不会越界或覆盖。
- 旧 source/sourceUrl 迁移为正确的静态或 Provider 来源。
- 纯 PoB Code 不会被猜测为 Provider 来源。
- 检查更新不改变构筑 revision。
- 远端相同、远端更新、本地修改和双方变化四种状态。
- 更新当前、创建副本和取消均符合原子性与 ID 规则。
- Provider 网络错误不改变已应用 fingerprint 和构筑内容。
- 启动、检查更新、后台任务和网络响应不会自动修改或创建 BD。
- 构筑中心左侧目录和右侧 BD 列表在常用窗口尺寸下均可访问，无重叠或不可达操作。
- 迁移前后同一构筑卡片的名称、职业、升华、等级、版本、区服、来源和时间语义一致。
- 构筑中心扫描和渲染不解码 `interop.pob.originalCode`。

## 10. 风险与回滚

### 10.1 最大风险

- 新旧权威数据并存导致页面、计算和导出不一致。
- 不完整 XML Builder 静默丢失 PoB 字段。
- 首次迁移部分成功后误写完成标记。
- 新 fingerprint 或语言 canonicalization 与持久化迁移混在一起。
- 引擎返回旧 revision 结果覆盖新编辑状态。
- 把 Provider 检查状态写入构筑导致无意义 revision 和冲突。
- 目录移动或批量删除中断后遗漏构筑，或同名目标被覆盖。

### 10.2 控制措施

- 每个领域显式 authority，禁止隐式 fallback 混合。
- 原始 Code 和迁移前字节保留。
- 每批次设置自动测试和实际 fixture 门禁。
- M2-M4 期间不修改仓库 fingerprint 语义。
- 跨语言/跨 realm canonicalization 单独立项，不纳入本次底层迁移。
- Provider 检查状态与 BuildDocument 分离；物理扫描决定构筑存在性和目录归属。
- authority 切换通过 feature flag 或 schema gate 控制，出现回归可退回 pob-code 读取，但不得丢弃结构化数据。

### 10.3 回滚原则

- 文件写入失败：保留正式文件和迁移备份，进入只读恢复。
- legacy 迁移失败：不写 marker，继续允许旧版本读取原 localStorage。
- Import/Projection parity 未通过：不切换对应领域 authority。
- 新版本 schema 被旧版本打开：旧版本只读，不自动降级。
- 已切换 authority 的数据不得通过回滚静默覆盖；只能恢复备份或显式导出兼容副本。

## 11. 明确排除项

以下内容不属于本方案基础完成条件：

- 完整伤害与防御解释 UI。
- 辅助宝石自动推荐。
- 市场装备提升排序和单位价格收益。
- 游戏内查价浮层。
- 双构筑比较。
- 游戏规划器文件互通。
- Provider 定时检查、自动同步和字段级自动合并。
- 多版本 Provider 更新历史与自动回滚。
- 仓库跨语言 canonicalization 和新版 semantic fingerprint。
- 云同步、账号和在线分享。

这些功能依赖本方案产出的 BuildDocument、Adapter 和 PobEngineClient，在 M5 以后实施。

## 12. 最终验收场景

必须在真实 Electron 应用中完成以下端到端验收：

1. 从旧版本 localStorage 启动，所有命名构筑迁移为独立 `.bd.json`。
2. 导入真实 PoB Code，仅解析一次并得到 BuildDocument。
3. 编辑天赋、装备、技能和 Config，关闭前自动保存草稿。
4. 异常退出后恢复草稿，内容与退出前一致。
5. 显式保存并重启应用，构筑从文件恢复。
6. 从仓库选择装备替换构筑槽位，仓库原装备不变。
7. 由 BuildDocument 生成 XML 并通过 LuaJIT 计算。
8. 导出 PoB Code，原版 PoB2 可以打开。
9. 原始 Code 与生成 XML 的约定指标通过 parity。
10. 删除仓库装备后，构筑仍能打开、计算和导出。
11. 清理 Chromium Cache/Local Storage 后，构筑和设置仍存在。
12. 损坏一个构筑文件时，其余构筑仍正常显示，损坏文件进入恢复列表。
13. 创建物理目录并移动构筑，重启扫描后组织状态保持；删除目录会先把构筑移回默认根目录。
14. 手动检查 Provider 更新只显示候选预览，选择取消时所有构筑文件保持不变。
15. 本地修改与远端更新同时存在时明确提示冲突，用户可覆盖当前或创建副本。
16. 构筑中心按左侧物理目录、右侧 BuildSummary 列表展示；旧构筑迁移后原有卡片信息和操作不减少。

完成以上场景后，M2、M3 和 M4A 才可以标记完成，并开始依赖该基础实施 M5 及后续能力。
