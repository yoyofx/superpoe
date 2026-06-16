# PoB2 Web 当前任务看板

> 状态：项目已从早期 Canvas + Fastify/LuaJIT 原型推进到 PixiJS 前端天赋树、前端 PoB build code 导入/导出，以及 Web Worker + wasmoon 的前端计算迁移阶段。
> 当前重点：先修复 `dev` 构建基线，再移除后端产品路径，逐步把 PoB 功能收敛到纯前端 WASM 引擎。
> 最后更新：2026-06-15

---

## 当前状态

- 主渲染层：默认使用 PixiJS 8 / WebGL 2D 渲染天赋树；旧 `TreeCanvas` 仍保留为 fallback 和对照实现。
- 数据与资源：`public/data/tree-web-{version}.json`、`public/assets/`、`public/pob-lua/` 均作为浏览器运行时资源提交。
- Build code：PoB2 导入/导出已在前端 `src/engine/buildCode.ts` 完成，不再需要 Fastify 编解码接口。
- 计算：当前走 `src/engine/pobLuaWorker.ts`，通过 Web Worker + wasmoon Lua 5.4 WASM 加载 `public/pob-lua/` bundle 执行 PoB Lua。
- 后端：`server/`、Vite `/api` proxy、`dev:server`、`test:server` 仍存在，作为旧 LuaJIT 对照/遗留路径；目标是从产品路径移除。
- 详细 WASM 迁移方案见 [`docs/pob-wasm-frontend-migration-plan.md`](./pob-wasm-frontend-migration-plan.md)。

---

## 当前已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| 天赋树渲染 | [x] | PixiJS 8 主渲染层，绘制背景、orbit、connector quad、节点图标、frame、effect |
| Canvas fallback | [x] | 旧 `TreeCanvas` 保留，用于 fallback 和实现对照 |
| 资源管线 | [x] | tree data、DDS/WebP、orbit、UI、connector、PoB Lua bundle 管线已接入 npm scripts |
| 多版本数据 | [x] | 前端读取 `tree-versions.json`，按版本加载 tree data 和资源 |
| 职业/升华 | [x] | 支持职业、升华选择，渲染职业/升华背景 |
| 节点交互 | [x] | 缩放、平移、悬停、tooltip、搜索、高亮、分配/取消分配 |
| 分配规则 | [x] | 支持路径补齐、依赖剪枝、可分配节点计算、撤销/重做 |
| 武器组 | [x] | 支持 auto / weapon set 1 / weapon set 2，并导出到 build XML |
| 属性节点 | [x] | 支持 Str/Dex/Int 属性节点选择、显示和导入导出 |
| PoB code 导入 | [x] | 前端解码 PoB2 build code，恢复节点、职业、升华、武器组、属性覆盖 |
| PoB code 导出 | [x] | 前端生成 PoB2 build XML 和 export code，可替换导入 build 的 Tree 段 |
| 保存/读取 | [x] | localStorage 保存构筑，支持 JSON 导入/导出 |
| URL 分享 | [x] | 支持 URL hash 分享当前天赋树状态 |
| i18n 框架 | [x] | `useTranslation` 框架和基础 en/zh 文案已接入 |
| 计算入口 | [~] | 已接入 wasmoon worker，但 Worker API 仍窄，输出字段和一致性验证还需扩展 |

---

## 当前阻塞

| 优先级 | 任务 | 状态 | 说明 |
|--------|------|------|------|
| P0 | 修复前端构建基线 | [x] | 已通过现代 Node 验证 `tsc -b`、Vite build 和客户端测试 |
| P0 | 补齐 `translationLoader` | [x] | 已补齐 `@/i18n/translationLoader`，恢复 store 搜索翻译入口 |
| P0 | 补齐 `import.clear` 翻译 key | [x] | 已补齐 `Translations` 类型和 en/zh 文案表 key |
| P0 | 修复 2D context 类型 | [x] | 已收窄 `connectorSprites.ts`、`imageMipmaps.ts` 中 `getContext('2d')` 类型 |
| P1 | 清理 npm lockfile 平台字段噪音 | [ ] | 不同 npm/Node 版本会改写 optional package 的 `libc` 字段，需统一本地 Node/npm 口径 |

---

## 下一阶段：前端 WASM 化 PoB

> 目标：所有产品 PoB 功能在浏览器前端执行，不依赖 Fastify API。运行时继续使用 wasmoon Lua 5.4 WASM，第一阶段追求关键指标与桌面 PoB 一致。

| ID | 任务 | 状态 |
|----|------|------|
| W1 | 修复构建基线，确保 `npm run build` 和客户端测试可稳定运行 | [x] |
| W2 | 移除产品路径中的 `/api` fallback、Vite proxy、`VITE_CALC_BACKEND_FALLBACK` | [ ] |
| W3 | 将 `pobLuaClient` 抽象为 `PobEngineClient`，统一 Worker RPC、错误处理和 crash recovery | [ ] |
| W4 | 扩展 Worker 能力：`init`、`loadBuild`、`exportBuild`、`calculate`、`getBuildSummary` | [ ] |
| W5 | 扩展 Worker 能力：技能列表/更新、物品列表/更新、配置读写 | [ ] |
| W6 | 将 Worker 从一次性 XML 计算改为持有 build 状态的 PoB 引擎实例 | [ ] |
| W7 | 实现 PoB Lua bundle 懒加载，避免初始化时 mount 全量 Lua 文件 | [ ] |
| W8 | 建立关键指标 parity fixtures，对比属性、生命、护盾、抗性、防御、DPS、SkillDPS | [ ] |
| W9 | 将技能、物品、配置、calculation breakdown 面板逐步融入现有应用 UI | [ ] |
| W10 | 删除或隔离旧 `server/` 后端，更新 README 和开发命令 | [ ] |

详细设计和测试策略维护在 [`docs/pob-wasm-frontend-migration-plan.md`](./pob-wasm-frontend-migration-plan.md)。

---

## 后续功能

| 任务 | 状态 | 说明 |
|------|------|------|
| 技能编辑 UI | [ ] | 基于 PoB Worker 暴露的技能数据实现技能组、主技能、support 管理 |
| 物品编辑 UI | [ ] | 支持装备槽、物品导入、基础编辑和对计算结果的影响 |
| 配置面板 | [ ] | 暴露 PoB Config tab 中影响计算的核心选项 |
| 计算详情 | [ ] | 展示 offense/defense breakdown、技能 DPS 明细和关键来源 |
| 多 spec 完整 UI | [ ] | 当前 store 有框架，仍需完整 SpecSelector / Compare UI |
| 专精效果完整数据 | [ ] | 当前已有框架，完整 masteryEffects 仍需从数据源补齐 |
| 外部网络功能 | [ ] | trade、archives、在线导入等需要单独设计浏览器-only 方案 |
| 移动端适配 | [ ] | 当前主要面向桌面视口，后续再做响应式工具布局 |

---

## 历史完成摘要

- Phase 0-9：完成基础 React/Vite/Zustand 项目、天赋树数据生成、Canvas 原型、导入面板、节点交互、撤销/重做、URL hash、LuaJIT 后端计算原型和早期测试。
- Phase 10-14：完成职业/升华、武器组、珠宝孔半径、专精框架、多 spec/对比框架。
- Phase 15：完成 DDS/WebP 资源管线、BC1/BC7 解码、节点 icon/frame/effect、背景、连接线纹理、视觉一致性修复和低 zoom 性能优化。
- Phase 16：完成 build XML 往返、保存/读取、构筑分享、i18n 框架、更多计算结果展示，并开始 PixiJS/WebGL 迁移。
- 2026-06：默认渲染层已切到 PixiJS；前端 PoB code 编解码完成；计算迁移到 wasmoon worker；新增纯前端 WASM 化计划文档。

旧研究和实现细节可参考：

- [`docs/pob2_web_headless_research_full.md`](./pob2_web_headless_research_full.md)
- [`docs/rendering_engine_analysis.md`](./rendering_engine_analysis.md)
- [`docs/pob-wasm-frontend-migration-plan.md`](./pob-wasm-frontend-migration-plan.md)

---

## 常用命令

```bash
# 安装依赖
npm install

# 前端开发
npm run dev

# 构建
npm run build

# 前端/引擎测试
npm run test:client-calc

# 旧后端对照测试（迁移完成后应移除）
npm run test:server

# Lua 脚本测试
npm run test:lua

# 资源和数据管线
npm run pipeline:check
npm run pipeline:all -- 0_5
npm run pipeline:lua
```

---

## 维护口径

- `TASKS.md` 从现在开始作为当前任务看板维护，不再记录完整历史流水账。
- 已完成的大段历史只保留摘要，避免旧架构描述误导后续开发。
- WASM 迁移的详细设计、接口和测试策略维护在独立计划文档中。
- 当某个高层任务拆成可执行 PR 时，再把它展开成更细的 checklist。
