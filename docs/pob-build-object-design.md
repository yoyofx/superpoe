# SuperPoE2 统一 PoB 构筑内存对象设计

> 状态：方案已确认，作为后续构筑状态收敛的实现基线
> 更新日期：2026-08-11
> 替代方案：[`build-document-m2-m4-implementation-plan.md`](./build-document-m2-m4-implementation-plan.md)（已作废）

## 1. 结论

SuperPoE2 不再建立一套脱离 PoB2 XML 的 `BuildDocument`，也不再从简化领域对象重建完整 PoB2 XML。

后续统一对象是 **PoB2 XML 的完整内存对象化形态**。完整 PoB2 XML 是构筑业务语义的权威载荷；技能、装备、天赋、Config、人物属性和计算均读取同一个对象 revision。名称、来源、标签、目录和时间等 SuperPoE2 自有信息由构筑库独立保存，不混入 PoB2 XML 语义。

```text
PoB Code --------------------+
WeGame URL -> PoB Code ------+--> 完整 PoB2 XML --> PobBuildObject
                             |                         |
打开 SuperPoE 原生构筑文件 --+                         +-- Tree / Items / Skills / Config 访问器
                                                       +-- 受控编辑命令、撤销和 dirty 状态
                                                       +-- 序列化为 XML / PoB Code
                                                       +-- PoB Lua 加载与计算
```

## 2. 已否定方案与原因

已否定的方案把 Tree、Items、Skills、Config 等内容提取为新的领域模型，再由该模型投影出 PoB2 XML。实际实现后出现技能显示、伤害计算和人物属性计算错误，说明简化模型没有完整承接 PoB2 的引用、默认值、兼容字段和运行语义。

以下方向不得恢复：

- 把 `BuildDocument` 作为 PoB 构筑的唯一事实来源。
- 分阶段把 Items、Skills 或 Config 的 authority 从 PoB XML 切换到自建结构。
- 从自建结构重新生成整份 PoB2 XML 供计算或导出。
- 让不同页面各自保存一份可独立变化的技能、装备或 Config 权威状态。

## 3. 对象定义

### 3.1 完整 XML 树

对象结构对齐 PoB2 [`xml.lua`](../public/pob-lua/xml.lua) 的可执行定义：每个元素包含元素名、字符串属性和有序子节点；子节点可以是元素或文本。

```ts
type PobXmlNode = PobXmlElement | PobXmlText | PobXmlComment | PobXmlCdata | PobXmlInstruction

interface PobXmlText {
  kind: 'text'
  value: string
}

interface PobXmlComment {
  kind: 'comment'
  value: string
}

interface PobXmlCdata {
  kind: 'cdata'
  value: string
}

interface PobXmlInstruction {
  kind: 'instruction'
  name: string
  attributes: Record<string, string>
  children: PobXmlNode[]
}

interface PobXmlElement {
  elem: string
  attrib: Record<string, string>
  children: PobXmlNode[]
}

interface PobBuildObject {
  readonly root: PobXmlElement
  readonly revision: number

  readonly tree: PobTreeAccessor
  readonly items: PobItemsAccessor
  readonly skills: PobSkillsAccessor
  readonly config: PobConfigAccessor

  apply(command: PobBuildCommand): PobBuildChange
  fork(): PobBuildObject
  snapshot(): { revision: number; xml: string; contentHash: string }
  getTreeState(): PobTreeState
  getTreeSpecStates(): { activeSpecIndex: number; specs: PobTreeState[] }
  getPassiveJewelItems(): NodeJewels
  toXml(): string
  toCode(): string
}
```

TypeScript 可以为已知节点提供完整类型映射和访问器，但底层通用 XML 节点必须保留，作为未知字段和新版 PoB2 字段的兼容边界。类型化视图是对象的查询接口，不是另一份持久化数据。

对象 `revision` 是当前会话内的修改序号，与构筑库文件的持久化 revision 分开。`fork()` 用于装备候选和构筑比较；临时副本的修改不得影响当前激活对象。

### 3.2 PoB2 定义来源

PoB2 没有集中在单个 XSD 中的声明式 Schema，但仓库内的 Lua 源码提供完整的可执行定义：

- `public/pob-lua/xml.lua`：XML 对象树解析与序列化。
- `public/pob-lua/Modules/Build.lua`：根构筑加载、保存和 section 注册。
- `TreeTab`、`ItemsTab`、`SkillsTab`、`ConfigTab` 等类的 `Load()` / `Save()`：字段语义、默认值和兼容规则。

实现 TypeScript 映射时以对应 PoB2 版本的这些代码为准，不凭样例 XML 猜测字段。PoB Lua 中的 `buildMode` 是从 XML 加载出的计算运行时，可以丢弃并从当前对象 revision 重建。

### 3.3 统一装备对象

构筑内装备和独立装备仓库使用同一种 PoB2 Item 语义，不再维护 `EquipmentItem`、`LibraryItemSnapshot` 或市场词缀快照作为第二份装备权威。运行时装备是 PoB2 `Item`；脱离构筑单独持久化时，保存能够无损重建该对象的规范化英文 Item Raw。

```ts
interface CanonicalEquipmentItem {
  format: 'pob2-item'
  raw: string
  pobVersion: string
  gameVersion: string
}
```

```text
PoB 构筑 Item Raw -----------+
自定义 PoB Item Raw ---------+--> new("Item", raw) --> PoB2 Item
Global listing --------------+          |
CN listing + 官方 Stat ID ---+          +--> Item:BuildRaw() --> 规范化英文 Item Raw
```

约束如下：

- `raw` 是装备内容的唯一持久化权威；名称、底材、词条分组、数值、面板属性和 Trade filter 都是 PoB2 Item 的派生视图。
- 国服与国际服共用 GGG stat code、`HashStats`、`stat_descriptions` 和 PoB2 Item Raw 格式，不建立 realm 专属装备模型。
- `realm`、league、listing ID、来源 URL、价格、卖家和可用状态属于市场来源，不进入 `CanonicalEquipmentItem`。
- 市场 Fetch 的 `extended.hashes`、option ID 和结构化 mod 数据是导入证据。它们用于把本地化 listing 转换为 PoB 英文 Item Raw，但不是装备或词缀的永久主键。
- `TradeStatResolutionSnapshot` 不随 canonical item 持久化。查价和找相似从当前 PoB `modLine` 动态计算 Stat ID；官方 Stats 目录和运行时解析结果只能作为可删除、可重建的缓存。
- 仓库 Entry ID 与构筑内 PoB Item ID 始终分离。装备写入构筑时分配新的 PoB Item ID，并通过 `PobBuildObject` command 更新 `<Items>` 与 ItemSet/Slot 引用。

市场导入统一经过同一 adapter。Global listing 可以直接使用通过 PoB2 校验的英文 description；CN listing 优先使用与 Global 同源的官方 Stat ID 反向定位 PoB2 stat descriptor，再结合 listing 实际值生成英文词条。任何来源只有在 `new("Item", raw)` 成功且 `Item:BuildRaw()` 往返语义稳定后，才能成为 canonical item；失败记录保留为 unresolved source，不得猜测英文 Raw。

### 3.4 PoB Lua 集成边界

统一装备方案复用 PoB2 已有的 `Item.lua`、`TradeHelpers.lua`、`stat_descriptions.lua`、`TradeSiteStats.lua` 和 `HashStats()`，不要求修改 `upstreams/PathOfBuilding-PoE2/` 或生成目录 `public/pob-lua/` 中的上游源码。

SuperPoE2 在自有 Item Bridge 中暴露 `parseItem`、`normalizeItem`、`validateItem`、受控编辑、Stat 反向索引和 Trade filter 生成能力。Bridge 可以是应用自有 Lua 模块或现有 Lua runtime 中的嵌入脚本，但不能形成 PoB2 Item 之外的第二权威模型。只有确认是 PoB2 本身无法解析真实英文游戏词条时，才向上游修复并通过资源管线同步，禁止长期维护生成文件私有补丁。

## 4. 生命周期与边界

### 4.0 当前构筑会话与对象所有权

`PobBuildObject` 是当前激活构筑的运行时单例，生命周期覆盖整个 BD 编辑会话，但不是跨构筑、跨窗口或跨进程的全局单例。它只存在于 renderer 的 `ActiveBuildSession` 中，由根级 Store/Session 管理，不能由装备页、技能页或其他页面各自创建。

```ts
interface ActiveBuildSession {
  buildId: string | null
  object: PobBuildObject
  dirty: boolean
  revision: number
  dispose(): void
}
```

存储边界必须保持清晰：

- `PobBuildObject` 和 XML AST 只存在于当前会话内存，不写入 `localStorage`、`.spoe` 或 Electron 主进程全局变量。
- 当前构筑的持久化载荷仍是 `BuildRecord.pob.code`；构筑中心继续使用现有 `localStorage`，用户明确保存的 `.spoe` 继续保存完整 PoB Code 和校验信息。
- `BuildRecord` 的名称、来源、标签、目录和时间等应用元数据与 `PobBuildObject` 分离，不混入 XML AST。
- LuaJIT sidecar/Worker 只接收对象生成的不可变 XML snapshot，不持有 renderer 的对象引用。

生命周期规则：

1. 加载或导入 BD 时，先处理旧会话的未保存状态，再释放旧对象，解码 XML 并只创建一个新的 `PobBuildObject`。
2. 切换页面、装备组或技能组时保持同一对象；所有页面通过 selector/accessor 读取它。
3. 编辑命令只修改当前对象并递增会话 `revision`；持久化 revision 与对象 revision 分开维护。
4. 切换到其他 BD、清空当前 BD 或关闭 renderer 时调用 `dispose()`，释放 XML AST、访问器缓存和派生视图；常驻 Lua runtime 可以继续运行，但不得保留旧构筑引用。
5. 计算请求携带对象 revision；对象被替换或释放后，旧计算结果不得回写当前 UI。

如果未来支持多个 renderer 窗口，每个窗口拥有独立 `ActiveBuildSession`；不在 Electron 主进程建立跨窗口共享的可变构筑对象。

### 4.1 单次加载

- PoB Code 解压为 XML 后，在当前 `ActiveBuildSession` 中只创建一次 `PobBuildObject`。
- WeGame 先转换为 PoB Code，再走相同加载入口。
- 打开 SuperPoE 原生构筑文件时验证 `BuildRecord`，读取其中的完整 PoB 载荷，再走相同加载入口；这是原生文件打开，不属于外部格式导入。
- 页面不得直接调用 `decodeCodeToXml()`、`fast-xml-parser` 或维护页面级 XML 缓存。

### 4.2 查询与编辑

- UI 通过 selector/accessor 查询同一对象，不直接遍历或修改底层节点。
- 所有编辑使用 command；一次成功命令只产生一个新 revision，并记录受影响的 section。
- 当前命令层同时支持 XML path 属性修改、唯一元素 selector 属性修改、唯一元素文本替换，以及 PoB2 装备/技能的受控编辑：ItemSet/武器组选择、装备槽位引用、完整 Item Raw、技能宝石属性和主技能组。selector 或结构引用匹配多个或零个节点时拒绝修改，避免误写未知或重复字段。
- 装备与技能编辑命令直接修改完整 XML AST，不先转换成新的领域模型；一次命令只递增一个对象 revision。装备 Raw 替换只改变目标 `<Item>` 的文本，槽位修改只改变目标 `<Slot itemId>`，因此未知属性、其它 Item、子节点顺序和引用仍由对象原样保留。
- `treeStore.pobBuildRevision` 是 renderer 可观察的对象 revision，装备、技能、Config、计算和导出路径以它触发重新读取；对象本身仍只存在当前 `ActiveBuildSession`。
- 对象修改必须保留未触及节点、未知属性、子节点顺序和 ID 引用。
- undo/redo 保存可逆 XML patch 或命令逆操作，不保存另一份领域对象。
- 派生视图按 `revision + section` 缓存；revision 变化后只使相关视图失效。

天赋树迁移采用渐进方式：Store 仍负责 Pixi 分配算法和交互状态，但节点、武器组节点、属性覆盖、专精效果和被动珠宝插槽的写入统一通过 `PobBuildObject` 命令完成。对象 accessor 从 active `<Spec>` 读取最新状态，Tree tooltip/渲染使用对象解析出的珠宝记录；Store 不再从旧 `importedBuildCode` 直接读取珠宝。前端的 `allocatedNodes` 是无损编辑投影：导入 XML 中的节点全部保留并绘制，取消节点时只移除用户明确点击的节点，不按前端连通性自动删除其它节点。PoB Lua 负责最终有效起点、孤立节点、特殊珠宝和计算语义，前端不复制这套完整规则。
当前产品只使用一套活动天赋方案；对象仍会保留 XML 中的其它 Spec，但不提供多 Spec UI。配置、装备、技能页面已统一通过 Store 的 active-object getter 读取，`importedBuildCode` 仅保留为持久化载荷和对象不可用时的兼容 fallback，不再作为页面运行时权威。

### 4.3 计算

- 每次计算从当前对象取得不可变 XML snapshot，并记录其 revision 和内容 hash。
- LuaJIT sidecar 或 Worker 加载该 XML；不得由前端重新拼装另一份计算 XML。
- Lua build 实例可以按 revision 复用，也可以在崩溃后由 XML snapshot 重建。
- 只有结果 revision 与当前对象一致时，技能、伤害和人物属性结果才能进入 UI。

### 4.4 计算配置边界

- PoB Code 中存在 `<Calcs><Input .../></Calcs>` 时，只把其中可识别的计算模式作为导入初始值；没有该段时按 PoB2 的 `EFFECTIVE` 默认模式处理，并不猜测 PoB2 界面中未导出的临时状态。
- 运行时返回的配置定义和用户选择保存在 SuperPoE 的本地计算方案中。方案通过 `configOverrides` 传给 LuaJIT，不写回 `PobBuildObject` 或 PoB Code；这样切换方案不会污染构筑内容，保存构筑也不会把本地实验条件伪装成 PoB2 导出的配置。
- 后续如果需要把某项配置正式写入 PoB Code，必须先确认 PoB2 对应的 XML 节点和导入/导出语义，再增加独立的 Config command；不得把 Lua 运行时的临时字段直接序列化进 XML。

## 5. 构筑库与原生格式

构筑库保存应用自有信息和完整 PoB 载荷。它是持久化记录，不是运行时 PoB 模型：

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

`BuildRecord` 是 SuperPoE 原生构筑格式。原生文件扩展名为 `.spoe`，内部当前使用 JSON 序列化，并通过固定 `format: 'superpoe-build'`、schema、文件 revision 和双层 SHA-256 校验；JSON 只是实现细节，不是与 PoB Code、WeGame 并列的导入/导出格式。其他库实现必须提供等价的版本、完整性与并发保护。构筑记录还必须满足：

- `pob.code` 可以独立恢复完整构筑并加载到原版 PoB2。
- 保存时由当前 `PobBuildObject` 生成 Code 和 hash，不读取页面级派生对象。
- 打开、保存、另存为和复制原生构筑文件时传输完整 `BuildRecord`，不把其 JSON 序列化结果当作运行时构筑模型。
- 构筑中心摘要可以缓存，但不能替代完整 PoB 载荷。

## 6. 收敛顺序

1. 实现与 `xml.lua` 语义一致的 XML 对象、序列化器、revision 和 section 索引，不改变现有页面行为。
2. 建立 SuperPoE2 Item Bridge，将构筑装备、市场收藏和自定义装备收敛为 PoB2 Item + 规范化英文 Item Raw。
3. 将技能、装备和 Config 的临时解析迁移为统一对象访问器，逐页删除重复解码和 `LibraryItemSnapshot` 权威读取。
4. 将天赋编辑从字符串/双状态改为受控 XML 命令，保证 Tree 修改后其他 section 原样保留。
5. 计算和技能排名统一消费当前对象的 XML snapshot，并用 revision 拒绝过期结果。
6. 保存、草稿以及原生构筑文件打开/另存为继续使用 `BuildRecord + 完整 PoB Code`；页面运行时统一通过 active `PobBuildObject` getter，`importedBuildCode` 只作为持久化和兼容 fallback。

迁移期间允许旧 selector 适配统一对象，但禁止建立新的第二权威数据源。

装备输入兼容的具体规则、WeGame 来源样本、规范化边界和后续维护模板见
[`pob-item-compatibility.md`](./pob-item-compatibility.md)。兼容层属于项目自有适配代码，不能通过修改上游 Lua 文件来实现。

## 7. 执行任务清单

> 这份清单是 `PobBuildObject` 改造的唯一进度记录。只有代码、测试和保存/导出验证都完成后，任务才能标记为已完成；聊天中的讨论不替代清单状态。

### 已完成

- [x] 建立完整 XML AST、`PobBuildObject`、`ActiveBuildSession`、生命周期和对象 revision。
- [x] 装备、技能和 Config 页面按当前对象读取；计算请求携带对象 snapshot、revision 和 content hash。
- [x] 计算结果过期保护：对象、构筑或武器组变化后，旧结果不得回写当前页面。
- [x] 计算、保存和 PoB 导出在存在活动对象时直接消费同一份 Code/XML snapshot；仅新建空构筑保留 `buildCode.ts` 生成路径。
- [x] 保存、原生构筑文件和导出优先使用对象生成的最新 PoB Code；保留旧 Code 作为兼容 fallback。
- [x] 保存、导出、角色等级和原生文件入口统一通过 Store 的 `getActivePobCode()` 读取当前对象，页面不再各自拼接对象/旧 Code。
- [x] 建立对象级装备命令：ItemSet/武器组选择、装备槽位引用、完整 Item Raw 替换。
- [x] 装备界面的 ItemSet 下拉和武器组选择已接入对象命令；切换后保留目标 ItemSet 自己的武器组属性。
- [x] 装备详情的“替换槽位”已通过装备仓库 Adapter 读取 canonical Item Raw，并以新 Item ID 写回当前 ItemSet/Slot。
- [x] 建立对象级技能命令：技能宝石属性更新和主技能组更新；歧义或缺失引用拒绝修改。
- [x] 建立对象级 active SkillSet 命令；多 SkillSet 切换保留其它 SkillSet 原始 XML。
- [x] 建立对象级 Tree Spec 状态命令；节点、树版本、职业/升华、武器组节点、属性覆盖、专精效果和被动珠宝插槽更新只修改当前 Spec，并保留其它 Spec 与未知 Tree 内容。
- [x] 提供 active Tree Spec accessor 和被动珠宝记录 accessor；Tree tooltip 与 Pixi 珠宝图标通过 Store accessor 读取对象最新 revision。
- [x] 技能页面已接入对象命令：默认只读，并通过详情标题栏的编辑按钮进入技能组启用/完整 DPS 状态、主技能组、主技能与辅助宝石的等级、品质和启用状态编辑。
- [x] 明确 Config 边界：本地计算方案通过 `configOverrides` 参与 Lua 计算，不写回 PoB Code。
- [x] 通过对象专项测试、客户端回归测试和生产构建门禁。

### 已完成的扩展

- [x] 将技能对象命令接入技能等级、品质、启用状态和辅助宝石编辑控件；默认只读，编辑按钮显式开启。
- [x] 技能页在多 SkillSet 构筑中提供 active SkillSet 选择，并以对象命令触发重新读取和计算。
- [x] ItemSet/武器组切换和 Tree 计算投影保留未选中的 ItemSet、插槽引用以及全部 ConfigSet；对象专项测试覆盖 activeConfigSet 不被改写。
- [x] 将天赋节点分配、武器组节点、属性节点、天赋珠宝和专精效果迁移为对象命令；产品当前只使用一套活动 Spec。
- [x] 天赋珠宝绑定已接入对象命令：仅允许已分配的珠宝孔操作；装备仓库中由 PoB 标准化类别确认的 Jewel 可绑定、替换和解除，绑定时新增 Item 并保留旧 Item/未知 XML 内容。
- [x] 页面运行时不再直接依赖 `importedBuildCode`；正常构筑通过 active `PobBuildObject` getter 读取，旧 Code 仅作为加载失败时的兼容 fallback。
- [x] 天赋树导入和编辑遵循无损投影边界：保留并绘制 XML 节点，显式取消只移除目标节点，最终有效性和计算交由 PoB Lua。
- [x] WeGame 已确认的 7 类装备词条兼容规则已集中在 Item 入口，并覆盖显示、保存、导出和 Lua 计算路径。

### 待完善（暂缓）

> 以下事项保留在设计基线中，但当前阶段暂不实施，不影响已验收的主流程。

- [~] 补充装备替换后的目标槽位校验、装备编辑控件和保存/导出回读验收。
- [~] 为对象编辑接入独立的 XML snapshot 级撤销与重做；当前仅保留 `restoreXml` 底层能力，不接入天赋树撤销栈或页面按钮。
- [~] 使用多 SkillSet、ItemSet、武器组、召唤物和 ConfigSet 构筑完成更大范围的 PoB2/LuaJIT 计算一致性回归。
- [~] 为多 Spec 建立对象 accessor 与 Store 的 activeSpec 映射；切换 Spec 时只切换 `<Tree activeSpec>`，不得重建或丢弃其它 Spec。
- [~] 删除天赋树的 Store 双状态和计算/导出时临时 Tree XML 覆盖。
- [~] 持续扩大 `Code -> Object -> XML/Code -> PoB2 Load` 的无损验收范围，覆盖未识别节点、属性、文本和引用。

### 更新规则

- 每完成一组任务，先更新本节状态，再运行对应测试并记录结果。
- 任何任务若仍依赖临时投影、页面派生状态或兼容 fallback，不得标记为已完成。
- 不修改 `upstreams/PathOfBuilding-PoE2/` 或 `public/pob-lua/` 上游 Lua；如需变更，必须单独建立上游同步任务。

## 8. 验收门禁

- 同一份构筑在未编辑时完成 `Code -> Object -> XML/Code -> PoB2 Load`，技能、装备、Config 和人物属性不变。
- 技能显示、技能组选择、DPS、Str/Dex/Int、Life/Mana/ES、抗性和防御结果与当前直接加载原始 XML 的基线一致。
- 编辑 Tree、Items、Skills 或 Config 后，原版 PoB2 可以加载导出 Code，未编辑 section 不丢失。
- 未识别节点、属性、文本和引用在非相关编辑后仍存在。
- 所有页面读取同一 revision；计算完成时 revision 已变化则结果不得显示。
- 从 PoB Code 或 WeGame 加载完整构筑时只创建一次统一对象；产品页面不再重复解码 PoB Code。
- PoB、Global listing、CN listing 和自定义文本在 canonical 化后生成相同的 PoB2 Item 结构；realm 不改变装备语义。
- 每件仓库装备可以仅凭规范化 Item Raw 重新创建 PoB2 Item；持久化 Stat resolution 缺失不影响找相似和查价。
- CN listing 的 Stat ID 到英文 Item Raw 转换必须覆盖复合、多行、option、负值和区间词条；无法验证的 listing 只保留 unresolved source。
- 代表性真实构筑必须覆盖多 SkillSet、ItemSet、武器组、召唤物、触发技能和多个 ConfigSet。
