# PoB2 Web 化与 Headless 计算调研方案

## 1. 背景

当前项目是 Path of Building Community Fork 的 PoE2 版本打包目录。核心业务逻辑由 Lua 脚本实现，Windows EXE 主要承担宿主运行时、窗口渲染、文件路径、压缩解压、更新和事件循环等职责。

目标是研究如何利用现有 Lua 脚本，在 Web 环境中加载 PoB2 BD 内容，并最终实现网页展示、天赋树编辑或 BD 数值计算。

## 2. 核心结论

PoB2 的计算逻辑主要在 Lua 脚本中，理论上可以脱离 EXE 执行。

但不能简单地单独运行 `Modules/Calcs.lua`，因为计算入口依赖完整的 `build` 对象，而该对象由 `Modules/Build.lua` 和多个 UI Tab 类共同初始化。

推荐第一阶段路线：

```text
Web 前端
  -> 调用后端 API
  -> 后端运行 headless Lua PoB2 服务
  -> 加载 PoB2 Lua 脚本和 BD
  -> 执行计算
  -> 返回 JSON 给前端
```

不建议第一阶段直接做浏览器内 Lua 运行，因为兼容成本较高。

## 3. 项目结构概览

关键目录：

- `Launch.lua`：程序启动入口，初始化窗口、加载 `Modules/Main.lua`、处理更新和全局事件。
- `Modules/`：核心业务逻辑，包含计算、构建管理、数据加载、词缀解析、物品工具等。
- `Classes/`：UI 控件和领域对象，例如 `Item.lua`、`TreeTab.lua`、`SkillsTab.lua`、`ItemsTab.lua`、`CalcsTab.lua`。
- `Data/`：静态游戏数据，包含技能、基础物品、词缀、传奇、怪物、任务奖励等。
- `TreeData/`：天赋树数据和图片资源，当前主要树版本为 `0_4`。
- `Builds/`：本地 BD 存档目录。
- `manifest.xml`：版本和更新清单。

## 4. PoB2 导入码原理

PoB2 导入码本质流程：

```text
BD XML
  -> Deflate 压缩
  -> Base64 编码
  -> URL-safe 替换
  -> 导入码字符串
```

生成逻辑位于 `Classes/ImportTab.lua`：

```lua
common.base64.encode(Deflate(self.build:SaveDB("code"))):gsub("+","-"):gsub("/","_")
```

导入逻辑：

```lua
local xmlText = Inflate(common.base64.decode(buf:gsub("-","+"):gsub("_","/")))
```

导出流程：

1. `self.build:SaveDB("code")` 将当前 BD 序列化为 XML，根节点为 `<PathOfBuilding2>`。
2. `Deflate(xmlText)` 压缩 XML。
3. `base64.encode(compressedData)` 转为 Base64 文本。
4. `gsub("+","-"):gsub("/","_")` 转为 URL-safe Base64。

导入流程：

1. 输入导入码。
2. `-` 还原为 `+`。
3. `_` 还原为 `/`。
4. Base64 decode。
5. Inflate 解压。
6. 得到 XML。
7. 调用 BD 加载逻辑。

伪代码：

```text
decodePoB2Code(code):
  normalized = trim(code)
  normalized = replace(normalized, "-", "+")
  normalized = replace(normalized, "_", "/")
  compressed = base64Decode(normalized)
  xmlText = inflate(compressed)
  return xmlText
```

分享链接不是新的编码格式。`pobb.in`、`maxroll.gg`、`poe.ninja` 等网站只是保存导入码并提供短链接；下载真实 PoB 内容后，仍按同样流程解码。

## 5. 计算入口分析

核心计算模块：

- `Modules/Calcs.lua`：计算系统入口，组合多个计算模块。
- `Modules/CalcSetup.lua`：初始化计算环境，关键函数是 `calcs.initEnv(build, mode, override, specEnv)`。
- `Modules/CalcPerform.lua`：执行主计算，关键函数是 `calcs.perform(env, skipEHP)`。
- `Modules/CalcActiveSkill.lua`：主动技能和技能组计算。
- `Modules/CalcOffence.lua`：进攻计算。
- `Modules/CalcDefence.lua`：防御计算。
- `Modules/CalcBreakdown.lua`：计算过程拆解。

`Modules/Calcs.lua` 中重要函数：

```lua
calcs.getNodeCalculator(build)
calcs.getMiscCalculator(build)
calcs.calcFullDPS(build, mode, override, specEnv)
```

这些函数不能脱离 `build` 单独执行。

## 6. Build 对象加载流程

BD XML 加载主要由 `Modules/Build.lua` 完成。

关键函数：

- `buildMode:LoadDB(xmlText, fileName)`
- `buildMode:LoadDBFile()`
- `buildMode:SaveDB(fileName)`

`LoadDB` 流程：

1. 解析 XML。
2. 检查根节点是否为 `<PathOfBuilding2>`。
3. 优先加载 `<Build>` 节点。
4. 将其他 XML 节点保存到 `self.xmlSectionList`。
5. 初始化各 Tab 后，再分别加载对应节点。

Build 初始化会创建：

```lua
self.importTab = new("ImportTab", self)
self.notesTab = new("NotesTab", self)
self.partyTab = new("PartyTab", self)
self.configTab = new("ConfigTab", self)
self.itemsTab = new("ItemsTab", self)
self.treeTab = new("TreeTab", self)
self.skillsTab = new("SkillsTab", self)
self.calcsTab = new("CalcsTab", self)
```

随后按节点类型调用各 Tab 的 `Load`：

- `ConfigTab:Load`
- `PartyTab:Load`
- `TreeTab:Load`
- `ItemsTab:Load`
- `SkillsTab:Load`
- `CalcsTab:Load`
- `ImportTab:Load`
- `NotesTab:Load`

最后调用：

```lua
self.calcsTab:BuildOutput()
```

生成计算结果。

## 7. Headless 运行难点

主要难点是 PoB2 Lua 代码并不是纯计算库，它混合了 UI 初始化逻辑。

即使只做计算，也会触发部分 UI 类构造。

典型宿主依赖：

- `LoadModule`
- `PLoadModule`
- `PCall`
- `ConPrintf`
- `GetTime`
- `MakeDir`
- `GetScriptPath`
- `GetRuntimePath`
- `GetUserPath`
- `IsKeyDown`
- `GetCursorPos`
- `DrawStringWidth`
- `NewImageHandle`
- `DrawImage`
- `DrawImageQuad`
- `DrawString`
- `SetDrawColor`
- `SetDrawLayer`
- `SetViewport`
- `GetScreenSize`

这些函数原本由 EXE 宿主提供。脱离 EXE 后，需要在 headless runtime 中实现 stub。

大部分绘图函数可实现为空函数：

```lua
function SetDrawColor(...) end
function SetDrawLayer(...) end
function DrawImage(...) end
function DrawImageQuad(...) end
function DrawString(...) end
function SetViewport(...) end
```

`DrawStringWidth` 可返回近似宽度：

```lua
function DrawStringWidth(size, font, text)
  return #(text or "") * size * 0.55
end
```

`NewImageHandle` 可返回 dummy 对象：

```lua
function NewImageHandle()
  return {
    Load = function() end,
    ImageSize = function() return 0, 0 end,
  }
end
```

## 8. 推荐架构

第一阶段推荐方案：

```text
Browser
  |
  | POST /api/calculate
  v
Web Backend
  |
  | 调用 Lua Runner 子进程
  v
Headless PoB2 Lua Runtime
  |
  | 加载 Lua 脚本
  | 加载 BD XML
  | 执行计算
  v
JSON Result
```

组件职责：

- Web 前端：上传 XML、粘贴 PoB2 导入码、展示 BD 基础信息和计算结果。
- Web 后端：提供 HTTP API、调用 Lua runner、处理导入码解码、返回 JSON。
- Lua Runner：初始化 headless 宿主环境、加载原始 Lua 脚本、加载 BD XML、执行计算并提取结果。

## 9. API 设计

### 9.1 计算 XML

请求：

```http
POST /api/calculate
Content-Type: application/json
```

```json
{
  "type": "xml",
  "content": "<PathOfBuilding2>...</PathOfBuilding2>"
}
```

响应：

```json
{
  "success": true,
  "build": {
    "name": "Imported Build",
    "level": 90,
    "className": "Mercenary",
    "ascendClassName": "Witchhunter"
  },
  "output": {
    "FullDPS": 1234567,
    "CombinedDPS": 900000,
    "Life": 2500,
    "EnergyShield": 300,
    "Mana": 650,
    "FireResist": 75,
    "ColdResist": 75,
    "LightningResist": 75,
    "ChaosResist": 20
  },
  "skills": []
}
```

### 9.2 计算导入码

请求：

```json
{
  "type": "importCode",
  "content": "eNrt..."
}
```

服务端流程：URL-safe Base64 还原、Base64 decode、Inflate、得到 XML、复用 XML 计算流程。

### 9.3 计算分享链接

请求：

```json
{
  "type": "url",
  "content": "https://pobb.in/xxxxx"
}
```

服务端根据 URL 匹配站点，下载 raw code，解码导入码并执行计算。

支持站点来自 `Modules/BuildSiteTools.lua`：Maxroll、pobb.in、poe.ninja、poe2db.tw、Pastebin、Rentry。

## 10. 前端功能分层

### 第一层：只读计算结果

目标：最快验证 PoB2 Lua 是否能脱离 EXE 正确计算。

功能：粘贴导入码、上传 XML、调用后端计算、展示核心数值。

核心字段：`FullDPS`、`CombinedDPS`、`TotalDPS`、`AverageDamage`、`Speed`、`CritChance`、`Life`、`EnergyShield`、`Mana`、`Spirit`、`Armour`、`Evasion`、`FireResist`、`ColdResist`、`LightningResist`、`ChaosResist`、`TotalEHP`、`CharmLimit`、`SkillDPS`。

### 第二层：BD 内容展示

展示装备、技能组、天赋点、配置项、Charm、Flask、Jewel 和主技能详情。

### 第三层：Web 编辑器

支持修改装备、技能、Config、天赋树点选、切换主技能、改变敌人等级和 Buff 模式，并在每次修改后重新计算。

### 第四层：完整 Web PoB

包括天赋树 Canvas/SVG/WebGL 交互、装备编辑器、技能宝石编辑器、计算 Breakdown、构筑保存与分享、多 build 管理。

第一阶段不建议直接做第四层。

## 11. 前端数据加载策略

计算所需数据继续由 Lua 后端加载。

前端展示用数据建议单独转换为 JSON：

- `Data/Gems.lua` -> `gems.json`
- `Data/Bases/*.lua` -> `bases.json`
- `Data/ModCharm.lua` -> `modCharm.json`
- `Data/ModItem.lua` -> `modItem.json`
- `TreeData/0_4/tree.lua` -> `tree.json`

原因：前端不需要理解 Lua 表，避免浏览器运行 Lua，降低耦合，并便于缓存和搜索。

## 12. 技术选型

### 方案 A：Node.js 后端 + Lua 子进程

推荐。

优点：Web API 与前端集成方便；Lua runner 隔离性好；Lua 崩溃不会拖垮 Web 服务；便于调试 stdout/stderr。

缺点：需要处理进程启动性能，高并发时需要 worker pool。

结构：

```text
Next.js / Express / Fastify
  -> spawn lua runner
  -> stdin JSON
  -> stdout JSON
```

### 方案 B：Lua HTTP 服务

可行，但不如方案 A 灵活。

优点：少一层子进程通信，可常驻 Lua VM。

缺点：Lua Web 生态较弱，错误隔离较差，全局状态较多，多请求隔离麻烦。

### 方案 C：浏览器 WASM Lua

不建议第一阶段使用。

优点：可纯前端离线运行，不需要服务器。

缺点：兼容成本最高，Lua C 模块、文件系统、压缩、网络、宿主 API 都需要重建。

## 13. MVP 实施计划

### 阶段 1：Headless Lua 验证

目标：命令行加载一个 XML BD，输出核心计算 JSON。

验收：

```bash
lua headless_runner.lua sample.xml
```

输出：

```json
{
  "success": true,
  "output": {
    "FullDPS": 123456,
    "Life": 2500
  }
}
```

### 阶段 2：导入码支持

目标：支持 PoB2 导入码输入。实现 URL-safe Base64 还原、Base64 decode、Inflate，并复用 XML 计算流程。

### 阶段 3：Web API

目标：后端提供 `/api/calculate`，支持 `xml` 和 `importCode`，捕获 Lua stderr，返回标准 JSON，并增加超时保护和输入大小限制。

### 阶段 4：Web UI

目标：页面可输入 BD 并展示结果。支持粘贴导入码、上传 XML、展示基础信息、核心数值、错误信息和原始 JSON。

### 阶段 5：BD 内容展示

目标：展示装备、技能、天赋等内容。后端返回装备列表、技能组、配置项和天赋节点 ID，前端渲染只读视图。

### 阶段 6：编辑和重算

目标：前端修改 BD 后重新计算。定义 patch API，支持修改配置、切换主技能、启用/停用装备或 Charm，并返回完整结果或 diff。

## 14. Headless Runtime 需要模拟的对象

### 14.1 launch

最小字段：

```lua
launch = {
  devMode = false,
  installedMode = false,
  versionNumber = "headless",
  noSSL = true,
}

function launch:ShowErrMsg(fmt, ...)
  error(string.format(fmt, ...))
end
```

### 14.2 main

最小字段：

```lua
main = {
  tree = {},
  popups = {},
  viewPort = { x = 0, y = 0, width = 1920, height = 1080 },
  defaultGemLevel = nil,
  defaultGemQuality = 0,
  defaultItemQuality = 20,
  defaultItemAffixQuality = 0.5,
  showThousandsSeparators = true,
  thousandsSeparator = ",",
  decimalSeparator = ".",
}
```

必要方法：

```lua
function main:LoadTree(treeVersion) end
function main:SetWindowTitleSubtext(subtext) end
function main:OpenMessagePopup(title, msg) error(title .. ": " .. msg) end
function main:OpenConfirmPopup(...) end
```

## 15. 风险与注意事项

### 15.1 全局状态风险

PoB2 Lua 大量使用全局变量，例如 `data`、`main`、`launch`、`buildSites`、`modLib`、`calcLib`、`common`。同一个 Lua VM 无法安全地同时计算多个 BD。

建议：MVP 每次请求启动独立 Lua 进程，后续优化为 worker pool，每个 worker 串行处理请求。

### 15.2 EXE 宿主函数缺失

脱离 EXE 后会缺少很多宿主函数。解决方式是分阶段补 stub；绘图函数全部 no-op；文件路径函数返回当前工作目录。

### 15.3 压缩兼容

需要确认 PoB 的 `Deflate`/`Inflate` 是 raw deflate、zlib wrapper 还是 gzip wrapper。可通过真实导入码测试。

### 15.4 天赋树图片加载

Headless 计算不需要图片。`NewImageHandle` 返回 dummy，`ImageSize()` 返回 `0, 0`，图片加载失败不应阻断计算。

### 15.5 UI 控件初始化

很多 Tab 构造函数会创建控件。建议保留原初始化流程，通过 no-op 渲染和输入函数让构造通过。

### 15.6 计算一致性

要与 EXE 输出一致，需要保证数据版本、`Settings.xml` 默认配置、BD XML、主技能选择、config 设置、敌人等级和 Buff 模式一致。

## 16. 推荐第一版目标

第一版只做：

- 输入：PoB2 XML 或导入码。
- 输出：核心数值 JSON。
- 不做编辑。
- 不做天赋树可视化。
- 不做装备编辑器。
- 不做完整 PoB UI 复刻。

完成后再扩展导入码、分享链接和 Web 展示。

## 17. 最终推荐路线

推荐执行顺序：

1. Headless Lua runner。
2. XML BD 计算。
3. 导入码解码。
4. Web API。
5. Web 结果展示。
6. 装备/技能/天赋只读展示。
7. 配置编辑与重算。
8. 天赋树交互。
9. 完整 Web BD 编辑器。

第一阶段成功标准：给定一个 PoB2 BD XML 或导入码，后端能脱离 EXE 输出与 PoB2 桌面版接近一致的关键数值。

---

# 项目规划

## 18. HeadlessWrapper.lua 现状

### 18.1 已完成部分

| 模块 | 状态 | 备注 |
|------|------|------|
| 渲染 Stub | [OK] | DrawImage、DrawString、SetDrawColor 等为空实现 |
| 输入 Stub | [OK] | GetCursorPos、IsKeyDown、SetWindowTitle |
| 图片 Stub | [OK] | NewImageHandle 返回 dummy，ImageSize 返回 1x1 |
| 模块加载 | [OK] | LoadModule/PLoadModule 使用标准 loadfile |
| 路径 Stub | [OK] | GetScriptPath、GetRuntimePath、GetUserPath 返回空字符串 |
| 回调系统 | [OK] | runCallback/SetCallback |
| 生命周期 | [OK] | dofile("Launch.lua") -> OnInit -> OnFrame |
| Build Helper | [OK] | newBuild()、loadBuildFromXML()、loadBuildFromJSON() |
| require 兜底 | [OK] | lcurl.safe 等缺失库自动跳过 |

### 18.2 已知问题

| 问题 | 状态 | 影响 |
|------|------|------|
| GetTime() | [WARN] 返回 0 | 影响定时逻辑 |
| DrawStringWidth() | [WARN] 返回 1 | 简化实现，不影响 headless 计算 |
| StripEscapes() | [WARN] 未实现 | 主要用于 UI 文本 |
| ConPrintf() | [WARN] 输出到 stdout | 调试用途 |

### 18.3 关键缺失

| 缺失项 | 状态 | 影响 |
|--------|------|------|
| Deflate(data) | [FATAL] 未实现 | BD 导出会失败 |
| Inflate(data) | [FATAL] 未实现 | 无法直接解码 PoB2 code |
| GetTime() | [TODO] 待实现 | 影响定时逻辑 |
| ConExecute() | [LOW] 空实现 | 高级模式下才用到 |

## 19. Deflate/Inflate 解决方案

PoB2 的 BD 压缩使用标准 zlib/deflate 体系。推荐由 Node.js 负责解码导入码，Lua 只处理 XML。

Node.js 验证代码：

```javascript
const zlib = require('zlib');

function decodePoB2Code(code) {
  const normalized = code.replace(/-/g, '+').replace(/_/g, '/');
  const compressed = Buffer.from(normalized, 'base64');
  try {
    return zlib.inflateRawSync(compressed).toString('utf-8');
  } catch (e) {
    return zlib.inflateSync(compressed).toString('utf-8');
  }
}
```

推荐流程：

```text
Web 前端 -> Node.js API
  1. 接收 PoB code
  2. Node.js 完成 URL-safe -> Base64 -> zlib inflate -> XML
  3. 将 XML 传给 Lua runner
  4. Lua 加载 XML 并计算
  5. 返回 JSON
```

## 20. 全局状态与并发模型

PoB2 Lua 使用大量全局单例，例如 `calcs`、`main`、`buildMode`、`launch`。同一个 Lua VM 无法安全并发计算多个 BD。

推荐模型：多进程 + 预热。

```text
Node.js Server
  +-- Worker Pool
      +-- Worker 1（idle）
      +-- Worker 2（busy）
      +-- Worker 3（idle）
```

每个 worker 有独立内存空间，Node.js 管理生命周期，worker 崩溃后自动重启。

## 21. 架构图细化

```text
Web 前端（React SPA）
  - 粘贴 PoB code / 上传 XML
  - 展示计算结果
  - 展示天赋树 Canvas/SVG
        |
        v
Node.js 后端（Fastify）
  - POST /api/calculate
  - POST /api/import-code
  - GET  /api/tree-data
  - zlib Inflate/Deflate
  - Lua Process Pool
        |
        v
LuaJIT Runtime
  HeadlessWrapper.lua -> Launch.lua -> Main.lua
  -> Build.lua -> Calcs.lua -> JSON stdout
```

技术栈：React + TypeScript、Vite、Canvas 2D、Fastify、LuaJIT、Python 预处理脚本、Node.js zlib。

## 22. 后续扩展方向

- 离线版：Electron 封装 Web 前端，内嵌 Node.js + Lua 运行时。
- 多语言：前端 i18n、后端多语言提示、社区翻译机制。
- 社交功能：用户账号、BD 分享与评论、收藏、排行榜。
- 高级分析：DPS 模拟器、装备对比、天赋树优化建议、Boss 战模拟。

## 23. 总结

本方案提供了一条从零构建 PoB2 Web 版的完整路线，核心解决以下问题：

1. 如何脱离 EXE 运行 PoB2 Lua。
2. 如何处理复杂 UI 依赖。
3. 如何实现高效并发计算。
4. 如何设计前后端分离架构。
5. 如何处理 PoB2 特有压缩格式。

通过分阶段实施，可以先在较短时间内验证可行性，再逐步迭代为完整在线 BD 工具。

## 24. 被动天赋树 Web 实现分析

### 24.1 当前架构

PoB2 被动天赋树主要由 4 个 Lua 文件组成：

- `Classes/PassiveTree.lua`：数据结构。
- `Classes/PassiveTreeView.lua`：渲染、缩放、平移、悬停和点击。
- `Classes/TreeTab.lua`：多 spec 管理。
- `Classes/PassiveSpec.lua`：节点约束逻辑。

### 24.2 tree.json 数据结构

关键字段：

- nodes：`id`、`name`、`icon`、`stats[]`、`group`、`orbit`、`orbitIndex`、`connections`、节点类型标记。
- groups：`x`、`y`、`nodes[]`、`orbits[]`。
- constants：`orbitRadii`、`orbitAnglesByOrbit`。
- bounds：天赋树边界。

节点没有预存坐标，运行时根据 group 中心点和 orbit 半径/角度计算。

建议预处理 `tree.json`，提前计算所有节点 `(x,y)` 并导出 `tree-web.json`。

### 24.3 渲染管线

`PassiveTreeView:Draw()` 的顺序：

1. 处理输入事件。
2. 计算 screen <-> tree 坐标变换。
3. 绘制背景、职业背景、group 背景。
4. 绘制连接线。
5. 绘制节点 effect、base icon、overlay。
6. 绘制珠宝孔和半径环。
7. 绘制搜索高亮和 tooltip。

### 24.4 推荐架构

前端使用 React + Canvas 2D 负责渲染和交互。后端使用 Node.js Fastify + LuaJIT Headless 负责约束校验和计算。

主要接口：

- `GET /api/tree-data?version=0_4`：返回预处理树数据。
- `POST /api/tree/allocate`：分配/取消分配节点，并由 Lua 校验。
- `POST /api/code/decode`：解码 PoB2 导入码并返回节点列表。
- `POST /api/tree/path`：返回两个节点之间的最短路径。

### 24.5 实施路线

- Phase 0：数据准备与脚手架。
- Phase 1：只读天赋树展示。
- Phase 2：导入分配。
- Phase 3：天赋树编辑器。
- Phase 4：高级功能，例如 jewel radius、heatmap、compare mode、移动端适配。

### 24.6 视觉风格升级

当前实现可先使用纯代码绘制圆形节点、连接线和背景。后续逐步升级：

- V2：Canvas 渐变增强，包括金属边框、发光连接线和星空背景。
- V3：集成已有 Orbit PNG 精灵。
- V4：完整 DDS 纹理管线，包含背景和节点图标。

### 24.7 SimpleGraphic 与 Canvas 2D 对比

PoB2 原始渲染由 `SimpleGraphic.dll` 负责，它是一个自定义 2D 图形宿主，不是 3D 引擎。

SimpleGraphic 的能力包括：纹理加载、纹理四边形绘制、自由四边形绘制、颜色 tint、Z-order、裁剪和文本绘制。

这些能力都可以用 Canvas 2D 对应实现：

| SimpleGraphic | Canvas 2D |
|---|---|
| DrawImage | ctx.drawImage |
| DrawImageQuad | ctx.setTransform + drawImage |
| SetDrawColor | globalAlpha、filter 或离屏 tint |
| SetDrawLayer | JS 渲染顺序 |
| SetViewport | ctx.clip |

关键结论：PoB2 的 `DrawImageQuad` 只使用仿射四边形，不需要透视变形，因此 Canvas 2D 足够。

补充结论：Canvas 2D 足够并不等于可以用手画线条/经验尺寸替代原生 draw data。要接近原生视觉，前端必须复刻 `PassiveTree.lua:BuildConnector()` 生成的连接线四边形、`PassiveTree.lua:GetNodeTargetSize()` 的节点尺寸，以及 `PassiveTreeView.lua` 的 layer 顺序和 `SetDrawColor()` tint 行为。

### 24.8 视觉差异根因

视觉差异来自实现缺口，不是平台限制：

- 数据复刻不完整：原生运行期会构造 connector quad，不能只按节点中心手画 arc/line。
- 连接线缓存和状态映射必须按 `Character/CharacterAscendancy/CharacterPlanned + LineConnector/OrbitN + Normal/Intermediate/Active` 解析。
- `Orbit1..Orbit9` 不是按 PNG 后缀 `1..9` 顺序映射；必须使用 `TreeData/0_4/tree.lua` 中的原生 assets 映射，例如 `Orbit1 -> *_normal9.png`、`Orbit9 -> *_normal1.png`。映射或贴图尺寸错位会导致节点位置正常但连线大面积飞线。
- 节点 icon/frame/effect 尺寸必须使用 `GetNodeTargetSize()` 的半宽/半高语义，而不是用固定半径推导。
- LessLuminance 不能用 alpha 近似；应使用乘色或至少 `brightness(0.5)`。
- 非原生视觉层（星空、orbit guide、猜测 group 背景、手画 glow 线）会扩大视觉差异。
- DDS/BC7 纹理解码仍然是素材完整性的前提。

所有缺口都可以用 Canvas 2D 修复。

当前代码已按此方向调整：`gen_tree_data.py` 预计算 `connectors[]` 和 `targetSize`，并从 `public/assets/connectors/{version}/` 的 PNG 头读取 connector 贴图尺寸；`TreeCanvas.tsx` 优先使用连接线贴图 quad，移除了手画主连接线、orbit guide 和猜测式 group 背景；`connectorSprites.ts` 修正了预加载缓存 key、状态映射和原生 Orbit 到 PNG 后缀的非线性映射。

`public/data/tree-web-0_4.json` 是 Web 端生成产物，不是原生游戏文件。原生输入仍然是 `sources/src/TreeData/0_4/tree.json` / `tree.lua` 和连接线 PNG；游戏更新后应重新跑 `python scripts/gen_tree_data.py 0_4`，不要手改生成后的 JSON。

缩小时出现明显毛边，放大后消失，属于 Canvas 2D minification 采样问题：Canvas 不会像 WebGL 一样自动生成 mipmap，高分辨率 PNG/WebP 在小尺寸下会直接重采样，容易把 alpha 边缘和细线采成锯齿。当前前端通过运行时 mipmap 缓存处理：`imageMipmaps.ts` 为纹理生成 1/2、1/4、1/8 等离屏层，背景、节点 DDS、orbit/ring 精灵和 connector quad 在缩小时优先从更接近目标尺寸的 mip 层绘制，同时保持 `imageSmoothingQuality = 'high'`。

### 24.9 LessLuminance

`LessLuminance()` 是纯 Lua 逻辑，用于对未分配节点做 50% 去饱和和 50% 变暗，然后通过 `SetDrawColor()` 影响下一次绘制。

Canvas 近似实现：

```javascript
ctx.filter = 'saturate(0.5) brightness(0.5)';
ctx.drawImage(spriteImg, dx, dy, dw, dh);
ctx.filter = 'none';
```

如果要像素级一致，需要使用离屏 canvas + `getImageData()` 手动处理像素。

### 24.10 推荐修复优先级

| 优先级 | 动作 | 影响 | 工作量 |
|---|---|---|---|
| P0 | 预计算并使用原生 connector quad，贴图绘制 `LineConnector/OrbitN` | 高 |
| P1 | 使用 `GetNodeTargetSize()` 还原 icon/frame/effect 尺寸 | 高 |
| P2 | 修复 `SetDrawColor`/LessLuminance 乘色行为 | 中 |
| P3 | 移除非原生视觉层，避免星空、guide、猜测背景污染对比 | 中 |
| P4 | 继续审计 DDS/BC7 frame/effect 完整性和 draw layer 顺序 | 中 |

完成这些项目后，天赋树视觉效果应与原始 PoB2 基本一致。
