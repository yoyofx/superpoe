# SuperPoE2 当前任务看板

> 状态：项目已进入 Electron 桌面工作台阶段，主流程包含 PixiJS 天赋树、PoB Code、装备/技能分析、配置计算、交易中心和实时监控。
> 当前重点：扩大 PoB/LuaJIT parity 覆盖、完善装备/技能编辑和文件级保存，同时继续验收双区服交易与通货行情数据源。
> 最后更新：2026-08-01

---

## 当前状态

- 主渲染层：默认使用 PixiJS 8 / WebGL 2D 渲染天赋树；旧 `TreeCanvas` 仍保留为 fallback 和对照实现。
- 数据与资源：`public/data/tree-web-{version}.json`、`public/assets/`、`public/pob-lua/` 均作为 Electron renderer 运行时资源提交。
- Build code：PoB2 导入/导出已在前端 `src/engine/buildCode.ts` 完成，不再需要 Fastify 编解码接口。
- 计算：桌面端优先通过 `PobLuaService` 调用常驻 LuaJIT sidecar；原生 runtime 缺失或失败时，Web Worker + wasmoon Lua 5.4 WASM 继续提供 fallback。
- 计算 UI：装备面板、技能 DPS/来源详情、召唤物结果和本地计算配置方案已接入；更完整的编辑和 parity 覆盖仍在推进。
- 交易：官方集市、统一装备仓库、搜索收藏、Live 购买目标、机会中心和通货行情已接入交易中心；真实登录、限流和长时运行验收仍需继续。
- 后端：`server/`、Vite `/api` proxy、`dev:server`、`test:server` 仍保留为旧对照/开发路径，不是桌面产品计算的默认依赖。
- [`docs/pob-wasm-frontend-migration-plan.md`](./pob-wasm-frontend-migration-plan.md) 已转为历史迁移记录；当前运行时契约见 [`docs/pob-lua-runtime.md`](./pob-lua-runtime.md)。

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
| 保存/读取 | [~] | 当前构筑库仍由 localStorage 保存；`.spoe` 原生文件的打开、保存副本、校验和系统文件关联已接入，后续迁移内部构筑库目录 |
| URL 分享 | [x] | 支持 URL hash 分享当前天赋树状态 |
| i18n 框架 | [x] | `useTranslation` 框架和基础 en/zh 文案已接入 |
| 原生 PoB 计算 | [x] | Electron 优先使用常驻 LuaJIT sidecar，失败时回退到 Wasmoon worker |
| 计算配置/详情 | [x] | 本地配置方案、翻译、伤害来源、breakdown 和技能 DPS 详情已接入 |
| 交易中心与监控 | [~] | 官方集市、装备仓库、Live 监控、机会中心和通货行情已接入，真实区服和长时 smoke test 待完成 |

---

## 当前阻塞

| 优先级 | 任务 | 状态 | 说明 |
|--------|------|------|------|
| P0 | 扩大 LuaJIT/PoB parity fixtures | [~] | 关键技能、装备和召唤物已有测试；仍需覆盖更多职业、Config、持续伤害和触发场景 |
| P0 | 文件级构筑保存与自动草稿 | [ ] | 当前主流程仍以 localStorage 为主，需按 [`persistent-storage-design.md`](./persistent-storage-design.md) 迁移到 Electron `userData` 并提供版本保护、草稿与损坏恢复 |
| P1 | 双区服交易长时验收 | [~] | 需要真实登录分区验证 DOM Adapter、Live 重连、限流、DPI、多显示器和断网回退 |
| P1 | 通货行情真实数据源验收 | [~] | 需要验证国服/国际服当前赛季选择、缓存新鲜度和异常报价 |

---

## 历史记录：前端 WASM 化 PoB

> 以下条目是早期纯前端 WASM 迁移方案的快照，不是当前待办。当前桌面计算以 LuaJIT sidecar 为主，浏览器/原生 runtime 回退契约见 [`docs/pob-lua-runtime.md`](./pob-lua-runtime.md)。

| ID | 任务 | 状态 |
|----|------|------|
| W1 | 修复构建基线，确保 `npm run build` 和客户端测试可稳定运行 | [历史] |
| W2 | 移除产品路径中的 `/api` fallback、Vite proxy、`VITE_CALC_BACKEND_FALLBACK` | [历史] |
| W3 | 将 `pobLuaClient` 抽象为 `PobEngineClient`，统一 Worker RPC、错误处理和 crash recovery | [历史] |
| W4 | 扩展 Worker 能力：`init`、`loadBuild`、`exportBuild`、`calculate`、`getBuildSummary` | [历史] |
| W5 | 扩展 Worker 能力：技能列表/更新、物品列表/更新、配置读写 | [历史] |
| W6 | 将 Worker 从一次性 XML 计算改为持有 build 状态的 PoB 引擎实例 | [历史] |
| W7 | 实现 PoB Lua bundle 懒加载，避免初始化时 mount 全量 Lua 文件 | [历史] |
| W8 | 建立关键指标 parity fixtures，对比属性、生命、护盾、抗性、防御、DPS、SkillDPS | [历史] |
| W9 | 将技能、物品、配置、calculation breakdown 面板逐步融入现有应用 UI | [历史] |
| W10 | 删除或隔离旧 `server/` 后端，更新 README 和开发命令 | [历史] |

详细设计和测试策略维护在 [`docs/pob-wasm-frontend-migration-plan.md`](./pob-wasm-frontend-migration-plan.md)。

---

## 后续功能

| 任务 | 状态 | 说明 |
|------|------|------|
| 技能编辑 UI | [ ] | 当前技能分析为只读；后续支持技能组、主技能、辅助宝石和等级品质编辑 |
| 物品编辑 UI | [ ] | 当前装备分析为只读；后续支持装备槽、物品导入、基础编辑和对计算结果的影响 |
| 配置面板 | [x] | 已提供本地配置方案、翻译和参与计算的核心条件；继续扩展覆盖面 |
| 计算详情 | [x] | 已展示技能 DPS、伤害链、点伤、暴击、速度和主要来源；继续补齐更多 breakdown |
| 多 spec 完整 UI | [ ] | 当前 store 有框架，仍需完整 SpecSelector / Compare UI |
| 专精效果完整数据 | [ ] | 当前已有框架，完整 masteryEffects 仍需从数据源补齐 |
| 外部网络功能 | [~] | 官方集市、交易仓库、Live 监控和通货行情已接入；查价浮层和更多网络数据源仍按交易设计推进 |
| 移动端适配 | [ ] | 当前主要面向桌面视口，后续再做响应式工具布局 |

---

## 历史完成摘要

- Phase 0-9：完成基础 React/Vite/Zustand 项目、天赋树数据生成、Canvas 原型、导入面板、节点交互、撤销/重做、URL hash、LuaJIT 后端计算原型和早期测试。
- Phase 10-14：完成职业/升华、武器组、珠宝孔半径、专精框架、多 spec/对比框架。
- Phase 15：完成 DDS/WebP 资源管线、BC1/BC7 解码、节点 icon/frame/effect、背景、连接线纹理、视觉一致性修复和低 zoom 性能优化。
- Phase 16：完成 build XML 往返、保存/读取、构筑分享、i18n 框架、更多计算结果展示，并开始 PixiJS/WebGL 迁移。
- 2026-06：默认渲染层已切到 PixiJS；前端 PoB code 编解码完成；计算曾迁移到 wasmoon worker，随后在桌面端接入 LuaJIT sidecar，并保留 Wasmoon fallback。

旧研究和实现细节可参考：

- [`docs/pob2_web_headless_research_full.md`](./pob2_web_headless_research_full.md)
- [`docs/rendering_engine_analysis.md`](./rendering_engine_analysis.md)
- [`docs/pob-wasm-frontend-migration-plan.md`](./pob-wasm-frontend-migration-plan.md)

---

## 常用命令

```bash
# 安装依赖
npm install

# Electron 桌面开发
npm run dev

# 构建
npm run build

# 前端/引擎测试
npm run test:client-calc

# 旧后端对照测试（仅保留为开发/兼容对照路径）
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
- WASM 迁移的历史设计、接口和测试策略维护在独立计划文档中；新增运行时变更应更新 `docs/pob-lua-runtime.md`。
- 当某个高层任务拆成可执行 PR 时，再把它展开成更细的 checklist。
