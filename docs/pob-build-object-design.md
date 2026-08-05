# SuperPoE2 统一 PoB 构筑内存对象设计

> 状态：方案已确认，作为后续构筑状态收敛的实现基线
> 更新日期：2026-08-03
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
type PobXmlNode = PobXmlElement | string

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

## 4. 生命周期与边界

### 4.1 单次加载

- PoB Code 解压为 XML 后只创建一次 `PobBuildObject`。
- WeGame 先转换为 PoB Code，再走相同加载入口。
- 打开 SuperPoE 原生构筑文件时验证 `BuildRecord`，读取其中的完整 PoB 载荷，再走相同加载入口；这是原生文件打开，不属于外部格式导入。
- 页面不得直接调用 `decodeCodeToXml()`、`fast-xml-parser` 或维护页面级 XML 缓存。

### 4.2 查询与编辑

- UI 通过 selector/accessor 查询同一对象，不直接遍历或修改底层节点。
- 所有编辑使用 command；一次成功命令只产生一个新 revision，并记录受影响的 section。
- 对象修改必须保留未触及节点、未知属性、子节点顺序和 ID 引用。
- undo/redo 保存可逆 XML patch 或命令逆操作，不保存另一份领域对象。
- 派生视图按 `revision + section` 缓存；revision 变化后只使相关视图失效。

### 4.3 计算

- 每次计算从当前对象取得不可变 XML snapshot，并记录其 revision 和内容 hash。
- LuaJIT sidecar 或 Worker 加载该 XML；不得由前端重新拼装另一份计算 XML。
- Lua build 实例可以按 revision 复用，也可以在崩溃后由 XML snapshot 重建。
- 只有结果 revision 与当前对象一致时，技能、伤害和人物属性结果才能进入 UI。

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
2. 将技能、装备和 Config 的临时解析迁移为统一对象访问器，逐页删除重复解码。
3. 将天赋编辑从字符串/双状态改为受控 XML 命令，保证 Tree 修改后其他 section 原样保留。
4. 计算和技能排名统一消费当前对象的 XML snapshot，并用 revision 拒绝过期结果。
5. 保存、草稿以及原生构筑文件打开/另存为切换为 `BuildRecord + 完整 PoB Code`，清理 `importedBuildCode` 作为页面运行时数据源的用法。

迁移期间允许旧 selector 适配统一对象，但禁止建立新的第二权威数据源。

## 7. 验收门禁

- 同一份构筑在未编辑时完成 `Code -> Object -> XML/Code -> PoB2 Load`，技能、装备、Config 和人物属性不变。
- 技能显示、技能组选择、DPS、Str/Dex/Int、Life/Mana/ES、抗性和防御结果与当前直接加载原始 XML 的基线一致。
- 编辑 Tree、Items、Skills 或 Config 后，原版 PoB2 可以加载导出 Code，未编辑 section 不丢失。
- 未识别节点、属性、文本和引用在非相关编辑后仍存在。
- 所有页面读取同一 revision；计算完成时 revision 已变化则结果不得显示。
- 从 PoB Code 或 WeGame 加载完整构筑时只创建一次统一对象；产品页面不再重复解码 PoB Code。
- 代表性真实构筑必须覆盖多 SkillSet、ItemSet、武器组、召唤物、触发技能和多个 ConfigSet。
