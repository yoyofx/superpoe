# SuperPoE2

SuperPoE2 是面向 Path of Exile 2 的 Electron 桌面构筑规划工具。它以 PoB2 数据和计算语义为基础，把天赋、装备、技能、配置和交易工作流集中到一个可离线使用的工作台中。

当前主流程包括：

- 导入、保存和导出 PoB2 Build Code，编辑天赋、武器组和属性节点，并保留原始 XML 信息。
- 使用 PixiJS 渲染天赋树，支持缩放、搜索、路径分配、武器组和升华交互。
- 展示装备基底面板、词缀来源、角色攻防汇总、武器 DPS，以及技能/辅助宝石的 DPS 和计算详情。
- 使用本地 PoB2 Lua 运行时计算；桌面版优先使用常驻 LuaJIT sidecar，失败时回退到 Web Worker + Wasmoon。
- 在交易中心内浏览官方集市、管理统一装备仓库、保存搜索、监控 Live 挂单并显示机会提醒。

产品完成度和后续里程碑见 [`docs/ROADMAP.md`](./docs/ROADMAP.md)，当前任务看板见 [`docs/TASKS.md`](./docs/TASKS.md)。

## Electron 桌面版

桌面版是唯一产品入口，保留 React、PixiJS、Web Worker 和 Lua 计算路径，不依赖本地 HTTP API。Electron main process 负责窗口、文件、官方集市会话、游戏窗口识别和受限 IPC；WeGame 分享导入通过主进程请求 PoE2DB 后返回完整 PoB code。装备与技能编辑仍属于后续迭代，不应与当前只读分析能力混淆。

开发运行：

```powershell
npm install
npm run dev
```

打包桌面安装程序：

```powershell
npm run dist:electron
```

electron-builder 默认把安装包写到仓库内 `release/`。可用 `package.json` 的 `build.directories.output` 或命令行参数覆盖。

从零准备上游并打包可用一键脚本：`.\scripts\build-local.ps1`（Windows）或 `./scripts/build-local.sh`（macOS/Linux）。说明见下方「初始化上游仓库」。

### GitHub Actions 自动构建

- **dev 固定渠道**：推送到 `dev` 或手动运行 `Build Dev` 后：
  - 构建 win-x64 + macOS，上传 Actions Artifact（保留 14 天）
  - 更新固定 Pre-release：**Releases → tag `dev`**（URL：`/releases/tag/dev`，附件每次覆盖）
  - 安装包内版本为滚动号：`{package.json 主版本}-dev.{run}.{shortsha}`（如 `0.5.0-dev.12.a1b2c3d`），便于区分构建；下载入口始终是同一页
- **正式 Release**：仅在 GitHub 上 **Publish release** 时触发；本地 `git tag` + `push` **不会**启动。也可手动运行 `Release` 工作流做验证。
  - 版本取自该 Release 的 Tag（如 `v0.5.0`），写入 `package.json`
  - 构建 win-x64 + macOS，上传 Artifact，并把安装包与 `SHA256SUMS.txt` 附到该 Release
  - 手动 `workflow_dispatch` 默认只上传 Artifact；勾选 `create_release` 才会创建/更新 Release
  - CI 构建**未代码签名**；Windows SmartScreen / macOS Gatekeeper 可能提示

首次安装依赖时，Electron 会下载与当前平台对应的 Chromium runtime。若下载被网络策略阻断，需要配置可访问 Electron 发布包的网络或镜像后重新执行 `npm install`。

应用入口统一为 Electron 桌面窗口。Vite 仅作为开发期间的 renderer 服务，不会自动打开浏览器，也不提供独立浏览器产品入口。

## 渲染层

前端天赋盘主渲染层已迁移到 PixiJS 8。PixiJS 是 WebGL/WebGPU 2D renderer，不是 Three.js 这类 3D 场景引擎；本项目仍按 PoB2 原生 2D 天赋盘数据绘制背景、节点、orbit 和 connector quad。

当前实现保留 React、Zustand、tooltip、导入导出和资源生成管线，只替换原来的 Canvas 2D 绘制层。旧 `TreeCanvas` 组件暂时保留为 fallback/对照实现，默认入口使用 `TreePixiCanvas`。

导入/导出 PoB2 build code 已在前端完成，不需要 Fastify 后端。Electron 桌面端优先通过主进程启动仓库内预编译的原生 LuaJIT sidecar，并使用 JSON Lines 协议执行构筑计算和技能排名；Windows x64 与 macOS Apple Silicon runtime 均随应用打包。`public/pob-lua/` 是从 `upstreams/PathOfBuilding-PoE2/src` 生成并锁定的 Lua 文件包，同时供原生 sidecar 和浏览器兼容层使用。原生 runtime 缺失、启动失败或崩溃时，renderer 会回退到 Web Worker + wasmoon；装备语义检查目前仍使用 wasmoon。

## 数据来源

所有上游数据、图片、翻译和 Lua 运行时资源统一遵守 [上游资源与生成管线标准](docs/resource-pipeline-standard.md)。上游是唯一事实来源；`public/` 是可重复生成并随应用发布的运行时产物，禁止手工修补。

- `upstreams/PathOfBuilding-PoE2/` 来源于 [PathOfBuildingCommunity/PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)，用于预处理脚本、Headless 校验和计算。
- `upstreams/PoeCharm2/` 来源于 [Chuanhsing/PoeCharm2](https://github.com/Chuanhsing/PoeCharm2)，用于同步 Web 端翻译数据。
- `public/data/tree-web-{version}.json` 是 Web 端生成产物，不是原生游戏文件，也不是 PoB2 上游文件。需要从 `upstreams/PathOfBuilding-PoE2/src/TreeData/{version}/tree.lua` / `tree.json` 重新生成时，运行 `npm run pipeline:all -- {version}`。

### 初始化上游仓库

两个上游仓库都位于 `upstreams/` 下，均为本地只读 Git checkout，不随本项目提交（非 submodule，`.gitignore` 忽略）。

**一键克隆/更新上游并打本地 Electron 包**（推荐）：

```powershell
# Windows (PowerShell)
.\scripts\build-local.ps1
```

```bash
# macOS / Linux
./scripts/build-local.sh
```

默认流程：`git clone` 或 `git pull --ff-only` 两个上游 → `npm install` → `npm run dist:electron`。安装包产物在仓库内 `release/`。Vite 前端产物在 `dist/`，Electron main 在 `dist-electron/`。

| 场景 | Windows | macOS / Linux |
| --- | --- | --- |
| 只打安装包，不碰上游 | `.\scripts\build-local.ps1 -SkipUpstreams` | `./scripts/build-local.sh --skip-upstreams` |
| 只准备环境，不打包 | `.\scripts\build-local.ps1 -SkipPackage` | `./scripts/build-local.sh --skip-package` |
| 更新上游后重跑资源管线再打包 | `.\scripts\build-local.ps1 -WithPipeline -TreeVersion 0_5` | `./scripts/build-local.sh --with-pipeline --tree-version 0_5` |

纯手动初始化也可以：

```bash
git clone https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git upstreams/PathOfBuilding-PoE2
git clone https://github.com/Chuanhsing/PoeCharm2.git upstreams/PoeCharm2
```

更新上游数据后，重新生成 Web 端数据和资源：

```bash
git -C upstreams/PathOfBuilding-PoE2 pull
git -C upstreams/PoeCharm2 pull
npm run pipeline:all -- 0_5
```

不要在两个上游目录内修改源码或 CSV；需要更新时在各自仓库中执行 `git pull`，再运行相应 pipeline。`public/` 下的生成运行资产必须提交。新机器若只运行现有前端，可不拉 `upstreams/`（`public/` 已提交）。

## 常用命令

```bash
npm install
npm run dev
npm run build
```

新机器如果只是运行现有前端，不需要先跑资源管线：`public/` 下的运行时数据和贴图已经随仓库提交。只有更新 `upstreams/`、生成新版本天赋树数据或重新生成贴图时，才需要安装下面的资源管线依赖。

Windows / PowerShell 初始化资源管线依赖：

```powershell
npm install
python -m pip install -r requirements.txt
npm run pipeline:check
```

`requirements.txt` 会安装 `Pillow` 和 `zstandard`。资源管线还需要能运行 `luajit`，用于把 `upstreams/PathOfBuilding-PoE2/src/TreeData/{version}/tree.lua` 转成 JSON。Windows 推荐用 `winget` 安装已验证可用的 LuaJIT 包：

```powershell
winget install --id DEVCOM.LuaJIT
```

安装后重新打开终端，并验证 LuaJIT：

```powershell
luajit -e "print(_VERSION); print(jit and jit.version or 'no jit table')"
```

如果 `luajit` 不在 PATH，可以在当前 PowerShell 终端设置 `LUAJIT_PATH`：

```powershell
$env:LUAJIT_PATH="C:\Users\<user>\AppData\Local\Programs\LuaJIT\bin\luajit.exe"
```

也可以写入用户级永久环境变量，之后重新打开终端：

```powershell
[Environment]::SetEnvironmentVariable("LUAJIT_PATH", "C:\Users\<user>\AppData\Local\Programs\LuaJIT\bin\luajit.exe", "User")
```

依赖安装完成后再检查并生成资源：

```powershell
npm run pipeline:check
npm run pipeline:all -- 0_5
```

如果 Tree Data 阶段失败，优先检查 `luajit` 是否可执行、`upstreams/PathOfBuilding-PoE2/runtime/lua/dkjson.lua` 是否存在，以及 `upstreams/PathOfBuilding-PoE2/src/TreeData/{version}/tree.lua` 是否存在。旧版 DDS/BC7 资源解码需要 `texconv.exe`；本仓库已包含 `scripts/texconv.exe`，新版 `0_5+` 的 WebP atlas 管线通常不依赖它。

资源和数据管线：

```bash
npm run pipeline:tree
npm run pipeline:planner
npm run pipeline:orbit
npm run pipeline:ui
npm run pipeline:dds
npm run pipeline:connectors
npm run pipeline:lua
npm run pipeline:translations
npm run pipeline:items
npm run pipeline:skills
npm run pipeline:skill-catalog
npm run pipeline:rune-details
npm run pipeline:item-bases
npm run pipeline:manifest -- 0_5
npm run pipeline:check
npm run pipeline:all
```

### 游戏规划器文件

桌面应用的“导出”菜单支持生成 Path of Exile 2 官方实验性 `.build` 规划器文件。可以选择“另存为”，也可以一键安装到游戏的 `BuildPlanner` 目录。导出内容包括天赋、武器组天赋、升华、技能与辅助关系，以及官方格式允许的装备槽位提示；它不会伪造完整稀有装备实例。

天赋规划器使用的字符串 ID 与 PoB 数字节点 ID 不同。`npm run pipeline:planner -- 0_5` 会从 PoE2DB 天赋树数据生成 `public/data/build-planner-passives-0_5.json`，并验证所有可分配节点均已映射。`pipeline:all` 已包含这一步，未来生成新天赋版本时无需手工维护节点映射；映射不完整会直接终止资源流水线。

`npm run pipeline:lua` 会从 `upstreams/PathOfBuilding-PoE2/src` 和 `upstreams/PathOfBuilding-PoE2/runtime/lua` 生成 `public/pob-lua/`。这个目录供浏览器计算 worker 懒加载，不直接修改上游源码。如果上游 PoB2 Lua 文件更新，重新运行该命令即可刷新前端 Lua bundle。

全量更新指定天赋树版本时，使用 `pipeline:all` 并在 `--` 后传版本号。例如未来上游出现 `0_5` 后：

```bash
npm run pipeline:all -- 0_5
```

该命令会生成 `public/data/tree-web-0_5.json`，复制/生成对应版本资源，并更新 `public/data/tree-versions.json`。它也会联网刷新 PoE2DB 的物品和技能离线资源，生成统一技能目录、Lua bundle 和全局资源 manifest，最后执行引用与覆盖率校验。前端版本下拉读取 tree manifest；资源管线只保留最新两个版本，生成 `0_6` 后会自动清理 `0_4` 及更早版本的 `tree-web` 数据、DDS、orbit 和 connector 运行资产。

普通的 `npm run build` 和桌面应用运行不会联网抓取资源。只有主动执行 `pipeline:items`、`pipeline:skills` 或 `pipeline:all` 时才会访问 PoE2DB；生成后的本地资源需要随仓库提交。

不传版本号时默认处理 `0_4`：

```bash
npm run pipeline:all
```

只查看将要执行的步骤，不实际生成资源：

```bash
npm run pipeline:all -- 0_5 --dry-run
```

测试和检查：

```bash
npm run test:server
npm run test:client-calc
npm run test:lua
```

## 项目结构

- `src/`：React UI、Zustand store、PixiJS 天赋树渲染、贴图和连接线渲染工具；旧 Canvas 组件保留为 fallback/对照实现。
- `server/`：Fastify API，用于开发期校验和旧 LuaJIT 计算对照；前端正常导入/导出不依赖它。
- `scripts/`：Python/Lua 预处理脚本和测试辅助脚本。
- `upstreams/PathOfBuilding-PoE2/`：PoB2 本地只读上游源码目录。
- `upstreams/PoeCharm2/`：PoeCharm2 本地只读翻译上游目录。
- `public/assets/`：复制或生成出来的运行时美术资源，浏览器会直接从这里加载。
- `public/data/`：生成后的 Web 天赋树数据和翻译数据。
- `public/pob-lua/`：从 PoB2 上游 `src` 生成的前端 Lua 运行时资源包，供计算 worker 懒加载。
- `docs/`：研究记录、渲染分析和任务历史。

## 说明

Web 天赋树渲染使用从 PoB2 上游数据生成出来的中间数据，不直接修改 `upstreams/PathOfBuilding-PoE2/` 文件。游戏或 PoB2 上游数据更新后，应重新运行对应 pipeline，而不是手改生成后的 JSON 或贴图产物。

`public/assets/dds/`、`public/assets/connectors/`、`public/assets/orbit/` 和 `public/assets/ui/` 是前端运行时资源，需要随仓库提交。这样新机器只要拉取仓库、安装依赖并启动前端，就能看到天赋节点、边框、背景、连线和 tooltip 资源；不需要为了正常显示先准备 `upstreams/` 或运行资源生成 pipeline。`upstreams/` 只在更新上游数据或重新生成资源时需要。

## PoeCharm2 翻译上游

PoeCharm2 与 PoB2 一样，作为 `upstreams/` 下的本地只读上游维护；不要直接修改其 CSV，也不要在 `public/data/Translate/` 中手工补充翻译。当前同步简体中文、繁体中文和韩文三个目录：

```powershell
git clone https://github.com/Chuanhsing/PoeCharm2.git upstreams/PoeCharm2
npm run pipeline:translations
```

`upstreams/PoeCharm2/` 已被 Git 忽略，运行时只提交同步生成的 `public/data/Translate/` 和 `translation-files.json`。同步脚本会完整镜像 PoeCharm2 的 `Data/Translate/zh-rCN`、`zh-rTW`、`ko-KR`，并生成固定顺序的 manifest；天赋专用 CSV 优先于通用或历史 CSV，重复英文词条不会因网络请求完成顺序而随机覆盖。

## 物品图标上游

纯 PoB Code 不带装备图标 URL。`npm run pipeline:items` 会从 [PoE2DB](https://poe2db.tw/us/Items) 的公开目录下载装备、珠宝、药剂、咒符和技能图标。物品资源写入 `public/assets/items/poe2db/` 和 `public/data/item-icons.json`；主动技能与辅助宝石写入 `public/assets/skills/poe2db/` 和 `public/data/skill-icons.json`。前端只读取这些本地资源，不在运行时热链 PoE2DB。WeGame 链接导入仍优先使用其返回的精确官方图标 URL。

装备面板会优先使用导入数据携带的精确图标 URL；没有该 URL 时，传奇装备按名称匹配，普通、魔法和稀有装备按底材匹配本地索引。

```powershell
npm run pipeline:items
```

该命令会以 `upstreams/PathOfBuilding-PoE2/src/Data/Bases/`、`Data/Uniques/`、`Data/ModRunes.lua` 和 `Data/Gems.lua` 校验资源覆盖，并解析 PoE2DB 的 `Skill_Gems`、`Support_Gems` 列表。只需刷新主动技能和辅助宝石时运行 `npm run pipeline:skills`。`pipeline:rune-details` 同时从 `Data/Skills/` 写入装备授予技能的原版描述，供装备孔位 tooltip 使用。仅诊断物品分类页时可传 `-- --skip-pob-bases --skip-pob-uniques --skip-pob-runes --skip-pob-skills`，但该模式不保证覆盖完整。

`npm run pipeline:skill-catalog` 会把 PoB `Data/Gems.lua`、`Data/Skills/*.lua` 与本地图片索引合并为 `public/data/skill-catalog.json`。它还会通过 PoB2 原生词条描述器，静态导出辅助宝石的基础数值，以及品质 0-30 中发生变化的词条。前端技能面板、辅助宝石和装备授予技能都以该 catalog 为统一读取入口，显示辅助宝石时不再调用 Lua；当前用户可见技能均有本地图片，无法从可信上游取得的描述保持为空，不人工编造。

装备授予技能的英文名称和描述以 PoB 技能 ID 为主键，`pipeline:skills` 会从 PoE2DB 的 `cn/tw/kr` 页面同步对应的简中、繁中和韩文名称与描述。生成数据写入 `skill-icons.json`、`skill-catalog.json` 和 `rune-details.json`，装备孔位 tooltip 优先显示当前语言的结构化描述；缺失时依次回退 PoeCharm2 通用翻译和 PoB 英文原文。首次同步会联网请求，后续运行复用 `.cache/poe2db/skill-localizations/`。

`npm run pipeline:manifest -- 0_5` 会生成 `public/data/resource-manifest.json`，记录 PoB/PoeCharm2 上游提交、资源覆盖统计、警告以及每个运行时文件的大小和 SHA-256。该文件既是发布审计结果，也是全量管线的最终完整性门禁。

PoB 中的 `Energy Blade` 是隐藏的技能生成武器，PoE2DB 没有独立物品图；三种 `Shrine Sceptre (Purity ...)` 也只是同一底材的技能变体。索引会分别回退到对应的一手剑/双手剑和 `Shrine Sceptre` 图标。

PoeCharm2 更新翻译后，执行：

```powershell
cd upstreams/PoeCharm2
git pull
cd ../..
npm run pipeline:translations
npm run test:server
npm run build
```

`npm run pipeline:all -- 0_5` 也会先同步翻译上游，再生成指定版本的 PoB2 天赋树和资源。

前端会优先按当前树版本加载 `public/assets/dds/{version}`、`public/assets/orbit/{version}` 和 `public/assets/connectors/{version}`。如果新版本资源尚未完整生成，会回退到 `0_4` 资源或 Canvas fallback 绘制；这个回退只影响贴图视觉，不会改变 `tree-web-{version}.json` 中的节点、坐标、连线关系和天赋数据。
