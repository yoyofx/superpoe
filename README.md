# PoB2 Web Tree

## 渲染层

前端天赋盘主渲染层已迁移到 PixiJS 8。PixiJS 是 WebGL/WebGPU 2D renderer，不是 Three.js 这类 3D 场景引擎；本项目仍按 PoB2 原生 2D 天赋盘数据绘制背景、节点、orbit 和 connector quad。

当前实现保留 React、Zustand、tooltip、导入导出和资源生成管线，只替换原来的 Canvas 2D 绘制层。旧 `TreeCanvas` 组件暂时保留为 fallback/对照实现，默认入口使用 `TreePixiCanvas`。

PoB2 Web Tree 是一个基于 React + PixiJS/WebGL 2D 的 PoE2 天赋树查看/编辑原型。项目使用 Path of Building 2 的天赋树数据，生成 Web 端可直接使用的数据和贴图资源，并提供天赋盘渲染、缩放/平移、节点交互、构筑导入导出，以及 Fastify/LuaJIT 计算接口。

## 数据来源

- `sources/` 来源于 [PathOfBuildingCommunity/PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)，用于预处理脚本、Headless 校验和计算。
- `public/data/Translate/` 来源于 PoeCharm2，用于 Web 端翻译数据。
- `public/data/tree-web-{version}.json` 是 Web 端生成产物，不是原生游戏文件，也不是 PoB2 上游文件。需要从 `sources/src/TreeData/{version}/tree.lua` / `tree.json` 重新生成时，运行 `npm run pipeline:all -- {version}`。

### 将 `sources/` 作为 Git Submodule

长期建议把 `sources/` 作为 Git submodule 指向 PoB2 上游仓库：

```bash
git submodule add https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git sources
git submodule update --init --recursive
```

首次克隆本项目时可以直接带上 submodule：

```bash
git clone --recursive <this-repo-url>
```

如果已经克隆过项目，但还没有拉取 submodule：

```bash
git submodule update --init --recursive
```

更新 PoB2 上游数据后，重新生成 Web 端数据和资源：

```bash
cd sources
git pull
cd ..
npm run pipeline:all
```

注意：如果要把现有本地 `sources/` 目录转换成 submodule，需要先移动或删除当前 `sources/` 目录。同时需要调整 `.gitignore` 中对 `sources/` 的忽略规则，让 Git 能追踪 submodule 入口；本地生成资源和临时文件仍可继续忽略。

## 常用命令

```bash
npm install
npm run dev
npm run build
```

新机器如果只是运行现有前端，不需要先跑资源管线：`public/` 下的运行时数据和贴图已经随仓库提交。只有更新 `sources/`、生成新版本天赋树数据或重新生成贴图时，才需要安装下面的资源管线依赖。

Windows / PowerShell 初始化资源管线依赖：

```powershell
npm install
python -m pip install -r requirements.txt
npm run pipeline:check
```

`requirements.txt` 会安装 `Pillow` 和 `zstandard`。资源管线还需要能运行 `luajit`，用于把 `sources/src/TreeData/{version}/tree.lua` 转成 JSON。Windows 推荐用 `winget` 安装已验证可用的 LuaJIT 包：

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

如果 Tree Data 阶段失败，优先检查 `luajit` 是否可执行、`sources/runtime/lua/dkjson.lua` 是否存在，以及 `sources/src/TreeData/{version}/tree.lua` 是否存在。旧版 DDS/BC7 资源解码需要 `texconv.exe`；本仓库已包含 `scripts/texconv.exe`，新版 `0_5+` 的 WebP atlas 管线通常不依赖它。

资源和数据管线：

```bash
npm run pipeline:tree
npm run pipeline:orbit
npm run pipeline:ui
npm run pipeline:dds
npm run pipeline:connectors
npm run pipeline:check
npm run pipeline:all
```

全量更新指定天赋树版本时，使用 `pipeline:all` 并在 `--` 后传版本号。例如未来上游出现 `0_5` 后：

```bash
npm run pipeline:all -- 0_5
```

该命令会生成 `public/data/tree-web-0_5.json`，复制/生成对应版本资源，并更新 `public/data/tree-versions.json`。前端版本下拉读取这个 manifest，因此后续新增 `0_6`、`0_7` 时不需要手改前端版本列表。

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
npm run test:lua
```

## 项目结构

- `src/`：React UI、Zustand store、PixiJS 天赋树渲染、贴图和连接线渲染工具；旧 Canvas 组件保留为 fallback/对照实现。
- `server/`：Fastify API，用于校验和计算。
- `scripts/`：Python/Lua 预处理脚本和测试辅助脚本。
- `sources/`：PoB2 上游源码目录，建议用 submodule 管理。
- `public/assets/`：复制或生成出来的运行时美术资源，浏览器会直接从这里加载。
- `public/data/`：生成后的 Web 天赋树数据和翻译数据。
- `docs/`：研究记录、渲染分析和任务历史。

## 说明

Web 天赋树渲染使用从 PoB2 上游数据生成出来的中间数据，不直接修改上游 `sources/` 文件。游戏或 PoB2 上游数据更新后，应重新运行对应 pipeline，而不是手改生成后的 JSON 或贴图产物。

`public/assets/dds/`、`public/assets/connectors/`、`public/assets/orbit/` 和 `public/assets/ui/` 是前端运行时资源，需要随仓库提交。这样新机器只要拉取仓库、安装依赖并启动前端，就能看到天赋节点、边框、背景、连线和 tooltip 资源；不需要为了正常显示先准备 `sources/` 或运行资源生成 pipeline。`sources/` 只在更新上游数据或重新生成资源时需要。

前端会优先按当前树版本加载 `public/assets/dds/{version}`、`public/assets/orbit/{version}` 和 `public/assets/connectors/{version}`。如果新版本资源尚未完整生成，会回退到 `0_4` 资源或 Canvas fallback 绘制；这个回退只影响贴图视觉，不会改变 `tree-web-{version}.json` 中的节点、坐标、连线关系和天赋数据。
