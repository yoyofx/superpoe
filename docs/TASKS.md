# PoB2 Web 被动天赋树任务路线图

> 状态：Phase 0-16 已完成。已实现 DDS 视觉还原、三层渲染、连接线纹理、保存/读取、i18n 与构筑分享。
> 最后更新：2026-05-28

---

## 项目结构

```
web/
|-- src/               # React 18 + TypeScript
|   |-- components/    # TreeCanvas、Toolbar、Sidebar、StatTable、SaveLoadPanel 等组件
|   |-- engine/        # coordinate、orbitSprites、connectorSprites、spriteLoader
|   |-- i18n/          # useTranslation 国际化 Hook（en/zh）
|   |-- store/         # Zustand treeStore，保存/读取、撤销/重做、计算
|   L-- types/         # tree.ts、calc.ts TypeScript 接口
|-- server/            # Fastify 后端接口
|-- scripts/           # Python 预处理脚本与 Lua 脚本
|-- sources/           # PoB2 Lua 源码，gitignored
|-- Builds/            # 测试样本，gitignored
L-- public/            # assets 与 data 静态资源
```

## Phase 0-9：全部完成 [x]

| 阶段 | 交付内容 | 状态 |
|------|----------|------|
| 0 | 脚手架、tree-web.json（4701 节点）、Zustand store、Canvas 引擎、Headless 验证 | [x] |
| 1 | Canvas 渲染、缩放/平移、悬停/点击、NodeTooltip、Toolbar、Sidebar、搜索 | [x] |
| 2 | Fastify + 解码 API、ImportPanel、已分配/可分配节点渲染 | [x] |
| 3 | 点击分配/取消分配、撤销/重做、LuaJIT 校验、导出编码 | [x] |
| 4 | 视口裁剪、URL hash 分享、版本选择器（0_1-0_4） | [x] |
| 5 | 单元测试：busted（Lua）+ vitest（Node.js），17/17 通过 | [x] |
| 6 | BD 计算：headless_calcs.lua、/api/build/calculate、Stormweaver 验证 | [x] |
| 7 | StatTable（三段式）、Calculate 按钮、E2E：tsc 0 错误 + build 176KB | [x] |
| 8 | V2 渐变效果（发光+星空+轨道）、V3 Orbit PNG 精灵（90 张） | [x] |
| 9 | 资源收敛：sources/ + Builds/ -> web/，修复 10 处路径 | [x] |

---

## Phase 10：职业与升华选择 [x]

目标：支持 7 个基础职业，以及每个职业 2-4 个升华。数据来自 `tree.json constants.classes`。

| ID | 任务 |
|----|------|
| 10.1 | 提取职业与升华数据类型，映射 AscendClassStart(20) 与 ClassStart(6) |
| 10.2 | treeStore 增加 selectedClassId、selectedAscendancyName，切换职业时重置分配 |
| 10.3 | Toolbar 增加 ClassPicker 下拉框与 AscendancyPicker 卡片 |
| 10.4 | 根据 constants.classes 在天赋树坐标中渲染升华背景 |
| 10.5 | 将 classId/ascendClassId 传给 /api/tree/validate，并更新 validate_spec.lua |
| 10.6 | 端到端验证：tsc + vite build + vitest |

## Phase 11：武器组 1/2 切换 [x]

目标：支持 PoE2 武器组切换。节点可分配到 Set 1（红色）或 Set 2（绿色）。

| ID | 任务 |
|----|------|
| 11.1 | treeStore 增加 weaponSetMode（0=auto/1/2）与 nodeWeaponSets Map<id, 0|1|2> |
| 11.2 | Toolbar 增加 WeaponSetToggle 按钮（1/2/auto） |
| 11.3 | TreeCanvas 根据武器组用红/绿/白区分已分配节点 |
| 11.4 | 将武器组参数连接到 validate_spec.lua 的 allocMode |

## Phase 12：珠宝孔与半径可视化 [x]

目标：珠宝孔使用菱形样式，并在悬停时显示半径范围。

| ID | 任务 |
|----|------|
| 12.1 | 识别 isJewelSocket 节点（tree.json 中共 12 个） |
| 12.2 | TreeCanvas 使用紫色菱形渲染珠宝孔 |
| 12.3 | 悬停时显示半径圆（node.radius * zoom） |
| 12.4 | 珠宝半径颜色：Neutral（灰）/ Primary only（红）/ Compare only（绿） |

## Phase 13：专精选择 [x] 框架完成

目标：带有 isMultipleChoice 的 Notable 节点提供专精子选项。框架已完成；完整 masteryEffects 数据仍需要从游戏文件提取。

| ID | 任务 |
|----|------|
| 13.1 | 从 tree.json 中识别 isMultipleChoice 节点 |
| 13.2 | treeStore 增加 selectedMasteries Map<nodeId, masteryIndex> |
| 13.3 | 点击时弹出专精选择面板（占位展示可选项） |
| 13.4 | 将专精选项传给 validate_spec.lua |

## Phase 14：多天赋页与对比模式 [x] 框架完成

目标：支持多个 spec 页签与对比模式，行为接近 PoB2 桌面版。框架已完成；SpecSelector、CompareToggle 等 UI 后续补齐。

| ID | 任务 |
|----|------|
| 14.1 | treeStore 增加 specs[]、activeSpecIndex、compareSpecIndex |
| 14.2 | 切换 spec 时保存/恢复 allocatedNodes |
| 14.3 | 对比渲染：红色表示移除，绿色表示新增 |
| 14.4 | 支持每个 spec 独立导入/导出 |

## Phase 15：DDS 节点图标与纹理管线 [x]

已完成内容：BC1 图标解码器（531 个图标）、BC7 边框/特效/背景、帧索引 off-by-one 修复、sprite-index.json、spriteLoader.ts、TreeCanvas 三层渲染（effect -> icon -> overlay）、默认 overlay fallback、PSGroupBackground 与升华背景。

原始渲染管线（PassiveTreeView.lua 约 L880-1130）：

```
Layer 15: activeEffectImage，发光层，未分配 alpha 0.15 / 已分配 1.0
Layer 20: connectors，连接线精灵四边形
Layer 25: node icon + nodeOverlay frame，按 alloc/path/unalloc 状态显示
Layer 30: search highlight ring
Post:    LessLuminance，未分配节点变暗
```

### 15.1-15.6：DDS 解码 + 精灵切片 + WebP 导出 + 前端 [x]

已完成纯 Python BC1 解码、sprite sheet 切片、WebP 导出管线，以及带渐进增强 fallback 的 spriteLoader.ts。

### 15.12：BC7 帧偏移 Bug 修复 [x]

根因：`dds_to_webp.py` 用 `frame_idx * frame_bytes` 访问 DDS 纹理数组元素，但 `tree.lua` 的 ddsCoords 使用 Lua 1-based 索引，frame 1 才是第一个元素。

结果：1338/1338 精灵解码成功，0 个失败，129/129 overlay frame 匹配。

### 15.13：DDS 管线重跑 [x]

删除所有缓存 WebP 输出，并在 off-by-one 修复后重新运行 `dds_to_webp.py`。BC7 解码使用 `texconv.exe`。

### 15.7-15.10：BC7 管线 + 三层渲染 [x]

通过 `texconv.exe` 解码 BC7 文件；`gen_tree_data.py` 导出 nodeOverlay、activeEffectImage、connectionArt 字段；TreeCanvas 完成三层 DDS 渲染。

### 15.11：连接线纹理 [x]

方案：连接线纹理是 `TreeData/0_4/` 中的独立 PNG 文件，不在 DDS 中。已复制 90 张 PNG 到 `public/assets/connectors/0_4/`，并新增 `src/engine/connectorSprites.ts` 负责预加载和绘制。

实现：

- `gen_tree_data.py` 复刻 `PassiveTree:BuildConnector()` / `BuildArc()`，预计算 `connectors[]` 的 tree-space textured quads
- `gen_tree_data.py` 按原生 `tree.lua` 的非线性映射解析 `Orbit1..Orbit9` 到 PNG 后缀，并从 `public/assets/connectors/{version}/` 读取 PNG 尺寸，避免游戏更新后手写尺寸失效
- `TreeCanvas.tsx` 使用 `drawConnectorQuadTexture()` 将 `LineConnector/OrbitN` PNG 仿射映射到四边形
- 状态选择：根据连接两端节点是否分配选择 Normal/Intermediate/Active
- 根据 `connectionArt` 自动选择 `Character`、`CharacterAscendancy` 或 `CharacterPlanned` 前缀
- 已移除手画三层 glow 线作为主视觉，避免与原生贴图连接线叠加失真

创建/修改文件：

- `web/scripts/gen_tree_data.py`
- `web/src/engine/connectorSprites.ts`
- `web/src/components/TreeCanvas.tsx`
- `web/public/assets/connectors/0_4/`

注意：`web/public/data/tree-web-0_4.json` 是生成产物，不是原生文件。更新 PoB2 原始数据或连接线 PNG 后，重新运行 `python scripts/gen_tree_data.py 0_4` 生成即可。

验证：`npm run build` 通过；当前仓库没有 `npm test` 脚本。

### 15.14：视觉一致性修复 [x]

已修复问题：

1. 升华背景过淡：alpha 调整为 1.0 / 0.5，匹配原始 PoB2 的 SetDrawColor 行为
2. 职业背景 alpha：0.8 -> 1.0
3. BGTreeActive 旋转环：alpha 0.5 -> 1.0
4. 连接线不显示：移除错误的 `ascendancyName` 与 `classesStart` 过滤条件
5. 缺失中心 overlay：补齐 BGTree 中心框，按 `class.background.bg.width x height` 缩放到 2000x2000

修改文件：

- `web/src/components/TreeCanvas.tsx`
- `web/package.json`

验证：tsc 0 错误，vite build 190KB，vitest 17/17 通过。

### 15.15：缩小时毛边修复 [x]

问题：Canvas 2D 缩小高分辨率 PNG/WebP 时没有自动 mipmap，节点、背景和连接线在小 zoom 下会出现明显 alpha 毛边；放大后问题消失。

实现：

- 新增 `web/src/engine/imageMipmaps.ts`，按图片缓存 1/2、1/4、1/8 等运行时 mip 层
- `TreeCanvas.tsx` 每次 render/resize 设置 `imageSmoothingEnabled = true` 与 `imageSmoothingQuality = high`
- 节点 icon/frame/effect、BGTree、职业/升华背景、orbit/ring 精灵和 connector quad 使用 mipped draw helper
- connector 两片三角形裁剪增加极小 overlap，降低缩小时拼接缝

验证：`npm run build` 通过。

### 15.16：低 zoom 性能优化 [x]

问题：缩小时可见节点和 connector 数量暴增，旧实现还会持续 `requestAnimationFrame` 重绘整棵树，静止画面也占用主线程。

实现：

- `TreeCanvas.tsx` 改为 `scheduleRender()` 按需单帧渲染，状态变化、资源加载和 resize 时才重绘
- connector 绘制前做 viewport bounding box 裁剪，屏幕外 quad 不再进入贴图绘制
- `zoom < 0.18` 时 connector 降级为低成本细线；`zoom < 0.12` 时跳过节点 frame/effect 等昂贵细节
- `imageMipmaps.ts` 改为按需生成 mip 层，并在资源加载完成后预热，减少缩放交互中的同步成本

验证：`npm run build` 通过。

## Phase 16：Backlog 可达项 [x]

| ID | 想法 | 状态 |
|----|------|------|
| 16.1-16.4 | 装备 + 技能模块 | [ ] 计划中，大功能，单独路线图 |
| 16.5 | 完整 build XML 往返（encode/decode cycle） | [x] 完成，已在 vitest api.test.ts 验证 |
| 16.6 | DPS / 完整属性展示扩展 | [x] 完成，包含 charges、skillDPS、ES regen、action speed |
| 16.7 | 构筑保存/读取（localStorage + JSON 导出） | [x] 完成，SaveLoadPanel + treeStore actions |
| 16.8 | WebGL 迁移（PixiJS） | [ ] 计划中，面向 4701 节点性能 |
| 16.9 | 构筑分享（URL hash 复制到剪贴板） | [x] 完成，SaveLoadPanel share button |
| 16.10 | i18n 多语言（en/zh 框架） | [x] 完成，useTranslation hook + 120+ keys |
| 16.11 | Electron 桌面版 | [ ] 计划中，离线 + 打包 LuaJIT |
| 16.12 | 移动端响应式 | [ ] 计划中，CSS 断点后续处理 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18、TypeScript、Vite、Zustand、TailwindCSS v3 |
| 渲染 | 原生 Canvas 2D，Phase 16.8 计划迁移 WebGL |
| 后端 | Node.js + Fastify |
| Lua 运行时 | LuaJIT 2.1，child_process one-shot worker |
| 预处理 | Python 3.8+ |
| 测试 | vitest（Node.js）、busted（Lua） |

## 外部依赖

### 运行时

| 依赖 | 版本 | 用途 | 安装 |
|------|------|------|------|
| LuaJIT | 2.1+ | Headless PoB2 计算与校验 | https://luajit.org/install.html |
| Python | 3.8+ | 所有预处理脚本 | https://python.org |
| Node.js | 18+ | 前端开发/构建 + 后端服务 | https://nodejs.org |
| busted | latest | Lua 单元测试框架 | luarocks install busted |

### NPM（package.json）

| 依赖 | 用途 |
|------|------|
| vite 5+ | 前端构建工具 |
| vitest 2+ | Node.js 测试运行器 |
| TypeScript 5+ | 类型检查 |
| fastify 5+ | 后端 HTTP 服务 |
| fast-xml-parser 4+ | 解析 PoB2 build XML |
| pako 2+ | PoB2 code 的 deflate/inflate |
| zustand 4+ | 状态管理 |
| tailwindcss 3+ | CSS utility 框架 |
| autoprefixer | CSS 厂商前缀 |
| rimraf | 跨平台 rm -rf |

### 构建期（Python 包）

| 包 | 用途 |
|----|------|
| zstandard | 解压 .dds.zst 文件 |
| Pillow | 图像处理与 WebP 导出 |
| texconv.exe | Microsoft DirectXTex BC7 DDS 解码器 |

### DDS 管线

所有 DDS 精灵已解码到 `web/public/assets/dds/{version}/`：

- `icons/`：531 个节点技能图标（BC1、BC7）
- `effects/`：60 个 activeEffectImage 发光效果（BC7）
- `frames/`：129 个 nodeOverlay 边框类型（BC7）
- `backgrounds/`：15 个升华/分组背景（BC7）
- `connectors/`：90 个连接线 PNG 纹理

管线脚本位于 `web/scripts/`：

- `extract_game_assets.py`：总编排脚本
- `gen_tree_data.py`：tree.json -> tree-web-{version}.json
- `dds_to_webp.py`：DDS 解码 + WebP 导出
- `parse_ddscoords.py`：sprite sheet 坐标解析
- `copy_orbit_png.py`：复制 orbit PNG 精灵
- `copy_ui_assets.py`：复制 UI 资源

## 仓库初始化（Fresh Clone）

```bash
# 1. 将 PoB2 源码克隆到 web/
git clone <pob2-repo> web/sources
# 或复制：cp -r ../sources web/sources

# 2. 复制测试样本
cp -r ../Builds web/Builds

# 3. 运行资源管线
cd web
python scripts/extract_game_assets.py --version 0_4

# 4. 安装并运行
npm install
npm run server &
npm run dev
```

## 验证命令

```bash
# TypeScript
npx tsc --noEmit

# 单元测试
npx vitest run

# 生产构建
npx vite build

# LuaJIT 校验
luajit scripts/validate_spec.lua '["4","5"]'

# DDS 管线
python web/scripts/extract_game_assets.py --version 0_4 --skip-dds
```

---
