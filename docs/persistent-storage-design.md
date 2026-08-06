# SuperPoE2 本地持久化、版本兼容与恢复设计

> 状态：方案已确认，待按 M2 实施
> 更新日期：2026-08-07
> 适用平台：Windows Electron 桌面端；保留 macOS Apple Silicon 兼容
> 关联路线图：[ROADMAP.md](./ROADMAP.md) M2“布局、工作流与构筑管理可靠化”

## 1. 文档目的

本文定义 SuperPoE2 的本地数据目录、文件边界、构筑与仓库格式、版本兼容、迁移、原子写入、自动草稿、备份恢复、安全边界和验收标准。

目标是让用户的构筑和交易数据不再依赖 Chromium `localStorage`，并满足以下承诺：

1. 应用升级、覆盖安装和清理浏览器缓存不会导致构筑丢失。
2. 开发版与正式版默认读取同一套用户数据。
3. 新版本可以逐级迁移旧数据；旧版本不得破坏新版本写入的数据。
4. 应用崩溃、断电或磁盘写入失败时，已有正式数据仍可恢复。
5. 单个构筑损坏不影响其他构筑；仓库损坏可从滚动备份恢复。
6. 登录凭据、Cookie 和缓存不进入构筑、仓库或普通备份。

本文只定义持久化基础。构筑运行时状态、完整 PoB2 XML 对象、编辑边界和计算一致性门禁见 [`pob-build-object-design.md`](./pob-build-object-design.md)。旧 `BuildDocument` 唯一权威和重建 PoB XML 的方案已经作废。装备和技能编辑仍属于 M3，但持久化格式必须始终保留可独立恢复的完整 PoB 载荷。

## 2. 已确认决策

以下决策作为实现基线：

1. 默认数据根目录统一使用 Electron `app.getPath('userData')`。
2. Windows 当前实际目录为 `%APPDATA%\SuperPoE2`，即 `C:\Users\<用户>\AppData\Roaming\SuperPoE2`。
3. 开发版与正式版不按 `-dev` 后缀分目录，默认共享数据。
4. `SUPERPOE_USER_DATA` 只用于自动化测试、临时验证和明确的故障恢复，不作为普通用户设置。
5. 每个命名构筑一个 `*.spoe` 文件；`builds/` 目录是唯一事实来源，启动时扫描目录生成内存索引。
6. 整个装备仓库继续使用一个 JSON 文件，不拆成单装备文件。
7. 设置使用一个 JSON 文件；短期 UI 状态与业务数据分离。
8. 登录状态继续使用 Electron persistent session；关键 `POESESSID` 只以 `safeStorage` 密文备份。
9. 所有业务文件独立维护 `schemaVersion`，不能使用应用版本代替数据格式版本。
10. 任何写入必须由 Electron 主进程完成；renderer 不直接访问任意文件路径。
11. 自动化测试必须使用临时 `userData`，不得读取或修改真实用户目录。
12. 同一数据目录同一时间只允许一个可写应用实例。开发版运行时再启动正式版，或反之，第二个实例不得同时写入。

## 3. 当前存储现状

### 3.1 仍在 localStorage 的业务数据

| Key | 当前内容 | M2 目标 |
| --- | --- | --- |
| `pob2-saved-builds` | 全部命名构筑数组 | 迁移为 `builds/<id>.spoe` |
| `pob2-imported-build` | 当前 Hash 对应的临时 PoB Code | 迁移为当前会话草稿，不再长期依赖 |
| `superpoe-global-settings` | 默认服务器、退出确认、UI 缩放、更新通道等 | 迁移为 `settings.json` |
| `pob2-language` | 当前 UI 语言 | 合并进 `settings.json` |

URL Hash 仍可用于临时分享天赋状态，但不能作为可靠保存介质。

官方腾讯集市分区中的 `lscache-trade2state` 属于远程页面自身状态，只用于兼容官网，不迁移到应用设置。

### 3.2 已在 userData 的数据

| 当前路径 | 内容 | 属性 |
| --- | --- | --- |
| `library/equipment-library.v1.json` | 装备、目录、搜索收藏、侧栏选择 | 业务数据，需保留和继续迁移 |
| `market/opportunities.v1.json` | 购买目标、批次、机会历史、监控设置 | 业务数据，保留独立 Repository |
| `trade/credentials.v1.json` | 按区服加密的 `POESESSID` 快照 | 敏感数据，不进入普通备份 |
| `trade/reference/` | 官方 Stat 等引用数据缓存 | 可删除缓存 |
| `currency-market/` | 第三方通货行情缓存 | 可删除缓存 |
| `Partitions/superpoe-trade-cn/` | 国服 Chromium persistent session | 敏感 Session 数据 |
| `Partitions/superpoe-trade-global/` | 国际服 Chromium persistent session | 敏感 Session 数据 |

现有仓库和机会 Repository 已使用临时文件、备份文件和重命名写入。M2 应把这套能力收敛为共享的文件存储基础，避免各 Repository 各自实现不一致的错误处理。

## 4. 目标目录结构

```text
%APPDATA%\SuperPoE2\
├─ settings.json
├─ ui-state.json
├─ storage-state.json
├─ builds\
│  ├─ <build-id-1>.spoe
│  ├─ <build-id-2>.spoe
│  ├─ 开荒\
│  │  └─ <build-id-3>.spoe
│  └─ 终局\
│     └─ <build-id-4>.spoe
├─ drafts\
│  └─ <build-id-or-session-id>.json
├─ backups\
│  ├─ builds\
│  ├─ library\
│  ├─ settings\
│  └─ migrations\
├─ library\
│  └─ equipment-library.v2.json
├─ market\
│  └─ opportunities.v1.json
├─ trade\
│  ├─ credentials.v1.json
│  └─ reference\
├─ currency-market\
└─ Partitions\
   ├─ superpoe-trade-cn\
   └─ superpoe-trade-global\
```

说明：

- 监控和凭据路径保持不变；装备仓库因 canonical PoB2 Item schema 升级为 `equipment-library.v2.json`。
- `equipment-library.v1.json` 只作为迁移输入和可恢复备份保留；完成迁移后不得继续双写。其他文件名中的 `v1` 仍是历史命名，不作为后续 schema 判断依据。
- `ui-state.json` 只保存可丢弃的窗口和界面偏好；损坏时直接回到默认值。
- `storage-state.json` 保存迁移记录、最近成功启动 schema 和恢复状态，不保存业务内容。

## 5. 通用文件信封

所有新增业务 JSON 使用统一的元数据语义：

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

字段规则：

- `schemaVersion`：该文件领域的数据格式版本。
- `revision`：每次成功写入递增，用于并发和草稿冲突检测。
- `writtenAt`：最后一次成功写入时间。
- `writtenBy.appVersion`：诊断信息，不参与 schema 判断。
- `payloadHash`：规范化序列化后 `data` 的 SHA-256，用于发现截断和意外修改，不是数字签名。
- `data`：领域数据主体。

`equipment-library.v2.json` 在 v1 到 v2 的 canonical Item 迁移时接入信封结构。现有 `opportunities.v1.json` 不要求同步改造，留到其自身下一次 schema 迁移时再接入 `revision`、`writtenBy` 和 hash，避免同时改动所有交易领域。

## 6. 构筑文件设计

### 6.1 一文件一构筑

本地文件路径为以下两种之一：

```text
builds/<uuid>.spoe                 # 默认目录
builds/<folder-name>/<uuid>.spoe   # 用户一级物理目录
```

`.spoe` 是 SuperPoE2 的原生构筑文件扩展名。文件内部使用 UTF-8 JSON，但扩展名不暴露序列化实现，可以注册系统文件关联并直接复制、备份和传播。

应用内部保存时，文件名只允许应用生成的 UUID，不使用用户输入的构筑名称，避免非法字符、重名和路径穿越。用户通过“另存为”或复制得到原生文件时可以使用经过清理的构筑名称，例如 `冰法开荒.spoe`；从外部打开并加入构筑库时由应用生成新的本地 UUID 文件名。

构筑文件必须自包含：只复制该文件到另一台兼容版本的 SuperPoE2，也能恢复构筑、重新计算并导出。完整 PoB Code 已包含构筑装备；构筑可以额外记录仓库装备 ID，但不能用仓库引用替代 PoB 载荷中的装备内容。

### 6.2 构筑库记录

构筑文件保存 SuperPoE2 自有元数据和一份完整 PoB Code。运行时打开构筑时，Code 解压并创建统一 `PobBuildObject`；文件结构本身不是运行时模型。

```ts
interface BuildRecord {
  id: string
  metadata: {
    name: string
    description?: string
    tags: string[]
    realm: 'cn' | 'global'
    source: 'local' | 'pob' | 'wegame'
    sourceUrl?: string
    createdAt: string
    updatedAt: string
    lastOpenedAt: string
  }
  pob: {
    code: string
    contentHash: string
  }
}
```

文件外层继续使用第 5 节定义的 `schemaVersion`、`revision`、`writtenAt`、`writtenBy` 和 payload hash。`pob.contentHash` 只覆盖 PoB Code 解码后的规范 XML 语义，用于检查载荷变化；应用名称、标签和目录不参与该 hash。

原生构筑文件在通用信封外增加固定标识 `format: 'superpoe-build'`。扩展名只能用于筛选候选文件，打开时必须同时验证该标识、schema、payload hash 和 PoB XML content hash。

### 6.3 权威数据与派生摘要

- `pob.code` 是可独立恢复的完整构筑载荷，必须包含 Tree、Items、Skills、Config、Notes 以及 PoB2 保存的其他 section。
- 打开后创建的 `PobBuildObject` 是当前会话唯一可编辑构筑实例；保存时从该对象生成新的 Code。
- 天赋、装备、技能和 Config 不再作为并列的持久化权威字段保存，也不使用 `authority` 在两份数据之间切换。
- 构筑中心需要的职业、升华、等级、树版本、装备数和技能数可以写入可重建摘要；摘要损坏或缺失时从完整载荷重建。
- 计算结果、Lua build 实例和页面 selector 缓存均为可丢弃派生状态，不写回构筑记录。

### 6.4 完整性与兼容

- 类型化访问器必须基于同一完整 XML 对象，不能生成独立的 Tree、Items、Skills 或 Config 数据副本。
- 未识别的元素、属性、文本、顺序和引用必须留在底层通用 XML 树中；编辑一个 section 不得重建或裁剪其他 section。
- 字段语义和兼容规则以绑定版本的 PoB2 `xml.lua`、`Build.lua` 及各 Tab `Load()` / `Save()` 为准。
- 保存后的 Code 必须能被对应版本的原版 PoB2 加载，并通过技能、伤害和人物属性 parity 门禁。
- 原始 PoB Code 可能较大，但属于构筑自包含能力；默认大小限制必须容纳经过验证的真实大型构筑。

### 6.5 应用自有数据

名称、描述、标签、来源、来源 URL、目录和时间属于构筑库，不进入 PoB2 XML。用户在 SuperPoE2 中保存的额外计算方案如果不能无损映射到 PoB2 ConfigSet，应保存在独立的、以构筑 ID 关联的应用数据区域，不得伪装成 PoB XML 权威字段。

仓库装备被删除或修改后，已经写入 `pob.code` 的构筑装备不得随之改变。仓库 ID 只能作为可选追踪信息，不能替代载荷中的 Item 内容。

### 6.6 原生构筑文件

`.spoe` 是 SuperPoE 原生构筑文件，JSON 只是当前内部序列化方式，不作为与 PoB Code、WeGame 并列的导入/导出格式。用户操作语义是打开、保存、另存为、复制和备份原生构筑文件。

打开原生文件时验证外层 schema、元数据和完整 PoB Code，再由统一加载入口创建 `PobBuildObject`；不得把 JSON 字段直接注入页面状态，也不得绕过 PoB XML 对象建立第二套构筑模型。打开其他机器复制来的原生文件时，保留记录中的原始 `source/sourceUrl`，不能把来源改写成 `json`。

旧 `SavedBuild.source === 'json'` 只作为 legacy migration 输入接受：如果旧记录无法恢复更早的真实来源，则迁移为 `local` 并保留迁移诊断；新记录不再产生 `json` 来源。

### 6.7 计算与缓存

计算请求使用当前 `PobBuildObject` revision 对应的 XML snapshot，并记录 revision、内容 hash 和引擎版本。结果返回时 revision 已变化则作为过期结果丢弃。需要持久化计算缓存时必须独立保存，且缓存永远不能成为构筑权威数据。

### 6.8 目录扫描与内存索引

不保存永久 `builds/index.json`。应用启动时扫描 `builds/*.spoe` 和 `builds/*/*.spoe`，验证后生成仅存在于当前进程内的构筑摘要：

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
  folder: string | null
  itemCount: number
  skillCount: number
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}
```

主进程 Repository 在内部维护 `buildId -> filePath` 映射；renderer 接收的摘要不包含绝对路径。

扫描规则：

1. 只匹配根目录和一级普通目录内扩展名为 `.spoe` 的普通文件，不跟随符号链接、junction 或其他 reparse point，不递归更深目录。
2. 使用有限并发读取和校验，例如同时最多 8 个文件。
3. 根目录表示“默认”，一级物理目录名称直接作为用户目录；目录按名称排序，构筑按用户选择的名称、更新时间、版本或来源排序。
4. 扫描遇到损坏构筑时将其放入恢复列表，不静默删除，也不影响其他构筑。
5. 新建、保存、另存为、复制、打开外部原生文件和删除成功后直接更新内存摘要，不需要重新扫描整个目录。
6. 只有实测大量构筑导致启动扫描持续超过 300 ms 时，才考虑增加可随时删除的缓存索引；缓存永远不能成为事实来源。

直接在 `builds/` 下创建一级目录，或把外部 `.spoe` 放入根目录/一级目录时，启动扫描可以识别。若文件内 ID 与现有构筑冲突但内容不同，应用必须进入原生文件 ID 冲突处理流程，生成新 ID 或由用户确认覆盖，不能按扫描顺序静默覆盖。

目录名必须经过主进程验证，拒绝非法字符、保留设备名、路径穿越、绝对路径、尾随空格/点和超长路径。删除目录时先逐个把构筑移回根目录，全部成功且目录为空后再删除；中途退出时下次扫描仍必须发现两处的全部构筑。

## 7. 自动草稿与未保存状态

### 7.1 草稿文件

草稿位于：

```text
drafts/<build-id-or-session-id>.json
```

草稿使用与构筑相同的 `BuildRecord` schema，并增加：

```ts
interface DraftMetadata {
  buildId?: string
  sessionId: string
  baseRevision?: number
  baseUpdatedAt?: string
  dirtyReason: 'tree' | 'items' | 'skills' | 'config' | 'metadata' | 'import'
  draftedAt: string
}
```

### 7.2 保存规则

- 用户修改后立即进入 dirty 状态。
- 默认在最后一次修改后 30 秒写草稿；连续修改使用 debounce，最大 2 分钟必须落盘一次。
- 应用失去焦点、窗口最小化和准备退出时立即请求一次草稿 flush。
- “保存”写入正式构筑文件，成功读回校验后删除对应草稿。
- “另存为”生成新构筑 ID，不覆盖原构筑。
- 未命名的新构筑使用 session ID 草稿；第一次显式保存后迁移为正式 ID。
- 关闭窗口时如果草稿已成功写入，可以提示“修改已保存为草稿”；不能把草稿描述成正式保存。

### 7.3 启动恢复

启动时比较草稿和正式文件：

- 草稿比正式文件新且 `baseRevision` 匹配：提供“恢复草稿”或“丢弃草稿”。
- 正式文件已在另一版本中更新：显示冲突预览，禁止静默覆盖。
- 只有草稿没有正式文件：作为“未保存构筑”显示在恢复入口。
- 草稿损坏：尝试草稿备份；仍失败时保留文件并显示诊断路径。

## 8. 设置与短期 UI 状态

### 8.1 settings.json

设置文件保存稳定的用户选择：

```ts
interface AppSettingsFile {
  language: 'en' | 'zh-rCN' | 'zh-rTW' | 'ko'
  defaultRealm: 'cn' | 'global'
  confirmUnsavedExit: boolean
  uiScalePercent: number
  updateChannel: 'release' | 'dev'
  updateCheckIntervalMinutes: number
  proxyDomains: string[]
  autoDraftIntervalSeconds: number
}
```

未来的快捷键、浮层透明度、资源目录等稳定配置也进入该文件。配置读取必须逐字段归一化，不能因为单个无效字段丢弃全部设置。

### 8.2 ui-state.json

只保存可丢弃状态，例如：

- 主窗口位置和大小。
- 上次打开的工作台 Tab。
- 交易中心上次打开的 Tab。
- 非业务面板的折叠状态。

目录树、装备排序、搜索排序属于业务数据，不能放在 `ui-state.json`。

## 9. 装备仓库文件

### 9.1 单文件决策

统一装备迁移完成后仓库整体保存在：

```text
library/equipment-library.v2.json
```

现有 `equipment-library.v1.json` 是迁移输入。首次成功迁移必须先保留原文件和最近有效备份，再原子写入 v2；不得原地覆盖唯一可恢复的 v1 文件。

当前上限为 5,000 件装备、1,000 个目录和 5,000 条保存搜索，单文件读取和完整事务写入仍然合适。达到以下任一条件后再评估分片或 SQLite：

- 文件持续超过 20 MB 并产生可感知的保存卡顿。
- 装备数量需要超过 10,000。
- 需要高频局部更新、复杂查询或跨进程并发写入。

在指标出现前不提前引入数据库。

### 9.2 文件内容

仓库文件继续包含：

- `entries`：所有 canonical PoB2 装备主体及其多来源信息。
- `folders`：装备目录与搜索目录树。
- `searches`：保存的官方搜索。
- `selectedFolders`：仓库和搜索视图的当前目录。
- 文件 schema、revision、写入版本和更新时间。

装备主体使用本地 UUID；`fingerprint` 对 `Item:BuildRaw()` 的规范化英文内容计算，只负责重复识别。Stat ID、listing ID、realm 和仓库来源都不能作为装备永久主键。

单件 canonical 装备包含：

- `format: 'pob2-item'`、规范化英文 `raw`、PoB 版本和游戏数据版本。
- 多来源数组：市场收藏、PoB 导入、装备收藏、查价和手工录入。
- 目录、排序、标签、备注和归档状态。
- 创建和更新时间。

名称、底材、有效词缀、数值、T 级、本地化显示和 Trade filter 都是 PoB2 Item 的派生视图，不重复写入仓库权威记录。`TradeStatResolutionSnapshot`、catalog template、候选 Stat ID 和 catalog hash 不随装备持久化。

市场 listing 的原始 `extended.hashes`、option 与结构化 mod 数据属于 canonical 化之前的来源证据。转换成功后可以只保留必要审计信息；转换失败时作为 bounded unresolved source 保存，以便数据更新后重试。嵌入物、`Bonded`、符文和其他 PoB2 支持的 Item Raw 内容不得为了仓库展示或 fingerprint 被清理；显示和查价是否忽略它们由派生策略决定。

### 9.3 来源与删除

- 同一装备允许多个来源并存。
- 取消市场收藏只移除对应 `market-favorite` 来源。
- 删除构筑不自动删除已经进入仓库的装备来源快照；可在后续维护任务中提示孤立来源。
- 用户执行“从仓库删除”才删除装备主体。
- 删除目录时将内容移动到默认目录，不级联删除装备和搜索。

## 10. 搜索收藏、购买目标与机会历史

领域边界保持现状：

- 保存搜索继续与仓库目录放在 `equipment-library.v2.json`，因为两者共享目录维护和仓库 UI；v1 文件只用于迁移和恢复。
- 购买目标、Live 批次、机会历史和监控设置保存在 `market/opportunities.v1.json`。
- 运行时 WebSocket 状态不持久化；启动后根据 armed 目标重建。
- 游戏运行状态不持久化，每次启动重新检测。
- 机会历史保持有界，当前只保留少量近期机会，避免文件无限增长。

删除保存搜索不能静默删除独立购买目标；删除或完成目标也不能删除仓库装备。

## 11. 登录信息与敏感数据

### 11.1 当前方案保持不变

国服和国际服使用独立 persistent session：

```text
Partitions/superpoe-trade-cn/Network/Cookies
Partitions/superpoe-trade-global/Network/Cookies
```

项目额外只备份对应区服的 `POESESSID`：

```text
trade/credentials.v1.json
```

该文件中的 Cookie 先通过 Electron `safeStorage.encryptString` 加密，再保存 Base64 密文。Windows 下密文与当前 Windows 用户绑定。

### 11.2 安全规则

- renderer、仓库、构筑、日志和诊断包不得读取 Cookie 原文。
- 普通“全量业务备份”默认排除 `credentials.v1.json` 和整个 `Partitions/`。
- 参考数据缓存和行情缓存不进入备份。
- IPC 只暴露登录状态、登录动作和注销动作，不暴露凭据值。
- 完整注销一个区服时，同时清理对应 persistent session Cookie 和加密凭据快照。

## 12. 共享开发版与正式版目录

共享目录减少重复登录、重复导入和手工复制数据，但必须解决两个风险。

### 12.1 禁止并发写入

- 应用启动时获取单实例锁；锁的范围与共享 `userData` 对应。
- 已有实例运行时，第二个 dev 或 release 实例不得进入可写工作台。
- 第二个实例可以通知已有实例聚焦窗口，但不能另开 Repository。
- 自动化测试通过独立 `SUPERPOE_USER_DATA` 运行，不参与真实目录锁。

### 12.2 dev 写入新 schema 后的正式版回退

- 文件 schema 高于当前程序支持版本时，旧程序进入只读保护。
- 旧程序不得用默认空数据覆盖高版本文件。
- UI 明确提示“该数据由更新版本写入，请升级后继续编辑”。
- 用户可从迁移前备份恢复旧 schema 副本，但恢复必须另存，不能自动覆盖新数据。

共享目录保证数据连续，不承诺旧版本可以编辑新格式。

## 13. schema 与迁移策略

### 13.1 独立 schema

以下领域分别演进：

- `settings`
- `build-document`
- `build-index`
- `draft`
- `equipment-library`
- `market-monitoring`
- `trade-credentials`
- `storage-state`

一个领域升级不应强迫无关领域同步升级。

### 13.2 逐级迁移

迁移只允许逐级执行：

```text
v1 -> v2 -> v3
```

禁止直接写一个无法单独测试的 `v1 -> latest` 大迁移。每个迁移函数必须：

- 输入和输出纯数据，不直接操作 UI。
- 可重复执行或有明确的已迁移检测。
- 校验输入 schema 和输出 schema。
- 不删除未知字段，除非迁移规范明确说明。
- 有固定 fixture 和失败用例。

### 13.3 迁移事务

1. 读取并校验原文件。
2. 把原始字节复制到 `backups/migrations/<timestamp>/`。
3. 在内存逐级迁移。
4. 校验目标 schema、数据约束和 payload hash。
5. 写临时文件并读回验证。
6. 原子替换正式文件。
7. 更新 `storage-state.json` 的迁移记录。

任一步失败都继续保留原文件和迁移备份，并以只读或恢复模式启动，不能退回空数据后继续保存。

## 14. localStorage 首次迁移

主进程无法直接读取 renderer 的 `localStorage`，因此使用一次性、受验证的 IPC 流程：

1. 主进程检查 `storage-state.json` 中是否完成 legacy migration。
2. renderer 只读取四个已知 key，不枚举或上传其他站点存储。
3. renderer 将原始值发送给受限的迁移 IPC。
4. 主进程限制总大小、解析并验证字段。
5. 原始 legacy 数据写入 `backups/migrations/local-storage-<timestamp>.json`。
6. `pob2-saved-builds` 按 ID 写成独立构筑文件；重复 ID 采用幂等更新规则。
7. 设置与语言合并写入 `settings.json`。
8. 当前临时导入构筑写为草稿，不自动创建命名构筑。
9. 主进程读回全部新文件并重新扫描构筑目录。
10. 成功后写 migration marker，应用切换到文件 Repository。

旧 `localStorage` 第一阶段不主动删除，只停止把它作为事实来源。这样可以在迁移实现缺陷时人工恢复，同时避免每次启动重复导入。

## 15. 原子写入与并发控制

### 15.1 写入流程

每次业务文件写入：

1. 在同一目录生成 `<file>.tmp-<pid>-<nonce>`。
2. 写入完整 UTF-8 JSON，并 flush 文件。
3. 重新读取临时文件，验证 JSON、schema、revision 和 hash。
4. 将现有正式文件复制到滚动备份。
5. 在同一文件系统内原子替换正式文件。
6. 必要时 flush 父目录。
7. 成功后清理临时文件。

启动时发现残留临时文件，只作为恢复候选，不能直接覆盖正式文件。

### 15.2 乐观并发

renderer 保存构筑时必须携带读取到的 `expectedRevision`：

- 当前 revision 相同：允许写入并返回新 revision。
- 当前 revision 已变化：返回 conflict，要求用户重新载入、比较或另存为。
- 不允许 renderer 发送完整任意路径，只能发送构筑 ID 和经过验证的数据。

单实例锁解决进程级并发，revision 解决异步 IPC 和旧窗口状态覆盖。

## 16. 备份、复制与恢复

### 16.1 自动备份

- 每次 schema 迁移保存不可变的迁移前备份。
- 每个构筑保留最近 5 个滚动备份。
- 仓库和设置各保留最近 3 个滚动备份。
- 草稿保留当前版本和一个上次成功版本。
- 自动清理只删除超过保留数量的滚动备份，不删除迁移失败证据。

### 16.2 用户备份

提供两种备份/复制方式：

1. 单构筑原生文件：可由另一台 SuperPoE2 打开，并保留 schema、应用元数据和完整 PoB 载荷。
2. 全量业务备份：一个带 manifest 的 JSON bundle，包含设置、全部构筑、仓库、保存搜索、购买目标和监控设置。

全量备份默认不包含：

- Cookie、`credentials.v1.json` 和 Session 分区。
- 官方 Stat 缓存、通货行情缓存、GPU/Code Cache。
- 机会历史中的临时运行状态；是否包含近期机会由备份选项明确说明。

### 16.3 备份恢复

恢复前必须显示预览：schema、构筑数、仓库装备数、目标区服和冲突数量。冲突策略由用户选择：

- 跳过同 ID。
- 作为副本恢复到构筑库并生成新 ID。
- 覆盖现有记录；覆盖前再次备份。

高于当前支持 schema 的备份只能检查和保留，不能强行降级恢复。

## 17. 损坏与错误处理

错误不得被静默转换为空数据。每个 Repository 使用统一状态：

```ts
type RepositoryHealth =
  | { status: 'ready' }
  | { status: 'recovered'; source: 'backup' | 'temporary' }
  | { status: 'read-only'; reason: 'future-schema' | 'permission' | 'conflict' }
  | { status: 'error'; reason: 'corrupt' | 'disk-full' | 'io' }
```

UI 要求：

- 顶部保存状态显示失败，不能继续显示“已保存”。
- 磁盘满、权限不足和文件占用显示可操作提示。
- 从备份恢复后说明恢复来源和可能丢失的最后修改时间。
- 损坏文件移入或复制到恢复目录，不自动删除证据。
- 索引损坏自动重建；业务文件损坏必须提示。

## 18. Electron 架构与 IPC

### 18.1 主进程服务

建议新增：

```text
electron/storage/
├─ atomicJsonFile.ts
├─ schemaMigration.ts
├─ storageCoordinator.ts
├─ appSettingsRepository.ts
├─ buildRepository.ts
├─ draftRepository.ts
└─ backupService.ts
```

职责：

- `AtomicJsonFile`：大小限制、读写、hash、临时文件和备份。
- `SchemaMigration`：逐级迁移注册表和 future-schema 检测。
- `StorageCoordinator`：启动检查、单实例写保护、健康状态和 legacy migration。
- `BuildRepository`：构筑 CRUD、目录扫描、内存摘要和 revision 冲突。
- `DraftRepository`：debounce 草稿和启动恢复。
- `BackupService`：用户备份、复制、恢复预览和冲突处理。

### 18.2 preload API

renderer 只获得窄接口：

```ts
interface BuildStorageBridge {
  list(): Promise<BuildSummary[]>
  read(id: string): Promise<BuildReadResult>
  save(input: BuildSaveRequest): Promise<BuildSaveResult>
  saveDraft(input: DraftSaveRequest): Promise<DraftSaveResult>
  delete(id: string, expectedRevision: number): Promise<void>
  duplicate(id: string, name: string): Promise<BuildSummary>
  migrationState(): Promise<LegacyMigrationState>
  importLegacy(payload: LegacyStoragePayload): Promise<MigrationResult>
}
```

IPC 主进程必须校验 sender、ID、字符串长度、数组上限、schema、文件总大小和 revision。

## 19. 分阶段实施

### P0：存储基础

- 实现共享 `AtomicJsonFile`、schema migration 和 Repository health。
- 增加共享 userData 单实例锁和测试目录约束。
- 将语言和全局设置迁移到 `settings.json`。

### P1：构筑 Repository 与首次迁移

- 实现一构筑一个 `.spoe` 文件、目录扫描和内存摘要。
- 迁移 `pob2-saved-builds`。
- 保持现有 `SavedBuild` 能力完整，不在此阶段强行完成 M3。
- 构筑中心改为异步读取主进程 Repository。

### P2：草稿和生命周期保护

- 接入 dirty reason、自动草稿、恢复入口和 revision 冲突。
- 统一关闭窗口、覆盖导入、切换版本和返回中心时的未保存处理。

### P3：备份恢复

- 单构筑原生文件的打开、另存为、复制和恢复。
- 全量业务备份、恢复预览和冲突处理。
- 损坏文件和索引重建 UI。

### P4：现有交易 Repository 加固

- 复用共享原子文件组件。
- 为仓库和监控文件增加 revision、writtenBy、hash 和 future-schema 只读保护。
- 不改变“仓库整体单 JSON”的决策。

### P5：M3 衔接

- 引入统一 `PobBuildObject`，完整映射 PoB2 XML 对象树。
- 将装备页、技能页和 Config 页的临时解析收敛为统一对象访问器。
- 将编辑和计算切换为同一对象 revision，保证未知 PoB 字段保留和无损导出。

## 20. 测试策略

### 20.1 单元测试

- 每个 schema 的合法、边界和非法 fixture。
- 所有逐级迁移及幂等性。
- payload hash、revision 冲突和 future-schema 拒绝写入。
- 仓库多来源合并、目录迁移和单文件恢复。
- 设置逐字段归一化。

### 20.2 文件系统测试

- 临时文件写入失败。
- 正式文件被占用、无权限和磁盘空间不足模拟。
- 写入中断后正式文件仍可读取。
- 正式文件损坏后从滚动备份恢复。
- 新增、删除、重命名和直接放入 `.spoe` 后目录扫描结果正确。
- 物理目录新建、重命名、构筑移动和删除中断后不丢失构筑。
- 路径穿越、非法目录名、符号链接和同名目标不会越界或覆盖文件。
- 单构筑损坏不影响列表中其他构筑。

所有测试使用临时 `SUPERPOE_USER_DATA`，并在结束后清理。

### 20.3 集成与桌面测试

- 从真实旧 `localStorage` fixture 首次迁移。
- 迁移中途退出后再次启动，结果不重复、不丢失。
- dev 写入高 schema 后旧 release 进入只读保护。
- dev 与 release 同时启动时只有一个可写实例。
- 自动草稿、异常退出、恢复、显式保存和草稿清理闭环。
- 覆盖安装和同版本重装后数据仍存在。
- 清理 Chromium Cache/Local Storage 后文件构筑仍存在。
- Windows 和 macOS 的 userData、权限和原子替换行为验证。

## 21. 性能与容量边界

- 构筑文件默认上限 10 MB；包含大型原始 PoB Code 时可提高到经过明确验证的上限。
- 设置文件上限 1 MB。
- 仓库文件当前硬上限保持 50 MB，并记录保存耗时。
- 构筑中心只读扫描后生成的内存 BuildSummary，不在启动时解析全部大型 PoB Code。
- JSON 序列化和 hash 可放入主进程任务队列，避免阻塞 renderer。
- 单次仓库保存持续超过 100 ms 时记录诊断指标；持续超过 20 MB 或 10,000 件时重新评估存储引擎。

## 22. M2 完成标准

M2 持久化部分完成必须同时满足：

1. 命名构筑、语言和全局设置不再以 `localStorage` 为事实来源。
2. 旧构筑首次启动可自动迁移，原始数据有备份且迁移可重试。
3. 每个构筑独立使用 `.spoe`，不依赖永久索引，直接扫描目录可完整恢复构筑列表。
4. 自动草稿可以从异常退出恢复，最多丢失一个草稿周期内的修改。
5. 所有正式写入经过临时文件、读回校验、revision 和备份。
6. 高 schema 数据在旧版本中只读，不能被空数据或旧格式覆盖。
7. dev 与 release 共享目录但不能并发写入。
8. 仓库保持单文件并支持损坏备份恢复。
9. Cookie 和加密凭据不进入 renderer、构筑、仓库、日志和普通备份。
10. 构筑保存、迁移、损坏、磁盘失败、草稿恢复和版本回退均有自动测试与实际桌面验收。

## 23. 明确不做

- 不为当前规模引入 SQLite。
- 不把所有构筑合并为一个大 JSON。
- 不按 dev/release 创建两套默认数据目录。
- 不允许 renderer 直接读写任意磁盘路径。
- 不将缓存、计算结果或 UI 临时状态作为构筑权威数据。
- 不把登录 Cookie 放入设置、构筑、仓库或用户业务备份。
- 不承诺旧版本可以编辑新 schema；只承诺旧版本不会破坏新数据。
