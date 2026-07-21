# PoB2 Web Tree

## Electron 桌面版

桌面版保留现有 React、PixiJS、Web Worker 和 WASM Lua 计算路径，不启动本地 HTTP API。
Electron main process 仅负责受限的系统能力；当前包含 WeGame 分享导入：renderer 通过 preload IPC 请求 main process，main process 调用 PoE2DB 并返回完整 PoB code。

开发运行：

```powershell
npm install
npm run dev:electron
```

打包桌面安装程序：

```powershell
npm run dist:electron
```

首次安装依赖时，Electron 会下载与当前平台对应的 Chromium runtime。若下载被网络策略阻断，需要配置可访问 Electron 发布包的网络或镜像后重新执行 `npm install`。

浏览器模式仍可使用 `npm run dev`，但不会显示 WeGame 自动导入入口；可继续使用普通 PoB code 导入。

## 渲染层

前端天赋盘主渲染层已迁移到 PixiJS 8。PixiJS 是 WebGL/WebGPU 2D renderer，不是 Three.js 这类 3D 场景引擎；本项目仍按 PoB2 原生 2D 天赋盘数据绘制背景、节点、orbit 和 connector quad。

当前实现保留 React、Zustand、tooltip、导入导出和资源生成管线，只替换原来的 Canvas 2D 绘制层。旧 `TreeCanvas` 组件暂时保留为 fallback/对照实现，默认入口使用 `TreePixiCanvas`。

PoB2 Web Tree 是一个基于 React + PixiJS/WebGL 2D 的 PoE2 天赋树查看/编辑原型。项目使用 Path of Building 2 的天赋树数据，生成 Web 端可直接使用的数据和贴图资源，并提供天赋盘渲染、缩放/平移、节点交互、构筑导入导出和计算入口。

导入/导出 PoB2 build code 已在前端完成，不需要 Fastify 后端。计算正在迁移到前端 Web Worker + PoB Lua bundle：`public/pob-lua/` 是从 `upstreams/PathOfBuilding-PoE2/src` 生成的浏览器只读 Lua 文件包。当前 worker 使用 `wasmoon` Lua 5.4 WASM 加一层 LuaJIT/PoB 兼容补丁运行；这是因为当前 PoB2 上游 Lua 已使用 `goto`，不能直接跑在 PUC Lua 5.1 WASM 上。需要和旧 LuaJIT 后端对照调试时，可以显式设置 `VITE_CALC_BACKEND_FALLBACK=true`。如果后续要求计算结果和桌面 PoB 完全逐位一致，仍建议继续推进 LuaJIT WASM 或专门的 PoB Lua 预处理方案。

## 数据来源

- `upstreams/PathOfBuilding-PoE2/` 来源于 [PathOfBuildingCommunity/PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)，用于预处理脚本、Headless 校验和计算。
- `upstreams/PoeCharm2/` 来源于 [Chuanhsing/PoeCharm2](https://github.com/Chuanhsing/PoeCharm2)，用于同步 Web 端翻译数据。
- `public/data/tree-web-{version}.json` 是 Web 端生成产物，不是原生游戏文件，也不是 PoB2 上游文件。需要从 `upstreams/PathOfBuilding-PoE2/src/TreeData/{version}/tree.lua` / `tree.json` 重新生成时，运行 `npm run pipeline:all -- {version}`。

### 初始化上游仓库

两个上游仓库都位于 `upstreams/` 下，均为本地只读 Git checkout，不随本项目提交。首次初始化时执行：

```bash
git clone https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git upstreams/PathOfBuilding-PoE2
git clone https://github.com/Chuanhsing/PoeCharm2.git upstreams/PoeCharm2
```

更新 PoB2 上游数据后，重新生成 Web 端数据和资源：

```bash
git -C upstreams/PathOfBuilding-PoE2 pull
git -C upstreams/PoeCharm2 pull
npm run pipeline:all -- 0_5
```

`upstreams/` 在 `.gitignore` 中忽略。不要在两个上游目录内修改源码或 CSV；需要更新时在各自仓库中执行 `git pull`，再运行相应 pipeline。`public/` 下的生成运行资产必须提交。

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
npm run pipeline:orbit
npm run pipeline:ui
npm run pipeline:dds
npm run pipeline:connectors
npm run pipeline:lua
npm run pipeline:check
npm run pipeline:all
```

`npm run pipeline:lua` 会从 `upstreams/PathOfBuilding-PoE2/src` 和 `upstreams/PathOfBuilding-PoE2/runtime/lua` 生成 `public/pob-lua/`。这个目录供浏览器计算 worker 懒加载，不直接修改上游源码。如果上游 PoB2 Lua 文件更新，重新运行该命令即可刷新前端 Lua bundle。

全量更新指定天赋树版本时，使用 `pipeline:all` 并在 `--` 后传版本号。例如未来上游出现 `0_5` 后：

```bash
npm run pipeline:all -- 0_5
```

该命令会生成 `public/data/tree-web-0_5.json`，复制/生成对应版本资源，并更新 `public/data/tree-versions.json`。前端版本下拉读取这个 manifest；资源管线只保留最新两个版本，生成 `0_6` 后会自动清理 `0_4` 及更早版本的 `tree-web` 数据、DDS、orbit 和 connector 运行资产。

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

纯 PoB Code 不带装备图标 URL。`npm run pipeline:items` 会从 [PoE2DB](https://poe2db.tw/us/Items) 的公开物品目录下载装备、珠宝、药剂和咒符图标到 `public/assets/items/poe2db/`，并生成 `public/data/item-icons.json`。前端应读取本地索引和本地图片，不在运行时热链 PoE2DB。WeGame 链接导入仍优先使用其返回的精确官方图标 URL；无 URL 的纯 PoB Code 则按传奇名或底材名查询该离线索引。

装备面板会优先使用导入数据携带的精确图标 URL；没有该 URL 时，传奇装备按名称匹配，普通、魔法和稀有装备按底材匹配本地索引。

```powershell
npm run pipeline:items
```

该命令会以 `upstreams/PathOfBuilding-PoE2/src/Data/Bases/`、`Data/Uniques/`、`Data/ModRunes.lua` 的完整底材、传奇、符文/灵魂核心清单校验分类页结果，并自动补抓缺失物品的 PoE2DB 详情页图标。仅诊断分类页时可传 `-- --skip-pob-bases --skip-pob-uniques --skip-pob-runes`，但该模式不保证覆盖完整。

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
