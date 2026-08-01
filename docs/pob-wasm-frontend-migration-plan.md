# WASM Front-End PoB Migration Plan (Historical Record)

> 文档性质：历史迁移方案。本文记录早期“纯前端 WASM”方向的分析、决策和阶段计划，不代表当前产品架构或完成状态。
> 当前桌面运行时：Electron 优先使用常驻 LuaJIT sidecar；原生运行时不可用时，renderer 回退到 Web Worker + Wasmoon。当前运行时契约见 [`pob-lua-runtime.md`](./pob-lua-runtime.md)。

## Summary

This document records the earlier plan to migrate PoB functionality to a pure front-end runtime.
The target architecture is React + Web Worker + wasmoon Lua 5.4 WASM running the
generated `public/pob-lua/` bundle, with no Fastify API dependency in product paths.

The document is retained as an architecture history and migration reference. Its
implementation snapshot and phase statuses are historical; update the runtime
contract and product status in `docs/pob-lua-runtime.md`, `docs/ROADMAP.md`, and
`docs/TASKS.md` instead of treating this file as an active backlog.

## Current Implementation Analysis

- Build code import/export is already implemented in the front end through
  `src/engine/buildCode.ts`. It handles PoB2 code deflate/base64 XML conversion,
  passive node lists, weapon-set nodes, attribute overrides, class data, and replacing
  tree XML inside an imported base build.
- Build calculation is partially migrated to `src/engine/pobLuaWorker.ts`. The worker
  loads wasmoon, mounts Lua files from `public/pob-lua/`, runs `HeadlessWrapper.lua`,
  loads build XML, calls `calcs.buildOutput(build, "MAIN")`, and returns a narrow
  `CalcResult` payload.
- The current worker interface is too narrow for desktop-level PoB features. It only
  supports `init` and `calculate`, and does not expose persistent build state,
  skills, items, config, breakdowns, comparisons, or report workflows.
- Legacy backend code is still present: Vite proxies `/api` to port `3001`, `server/`
  exposes Fastify routes, and `pobLuaClient.ts` can optionally fall back to
  `/api/build/calculate` through `VITE_CALC_BACKEND_FALLBACK`.
- Current `dev` build has known blockers before migration work can safely continue:
  missing `@/i18n/translationLoader`, missing `import.clear` translation typing, and
  2D canvas context type errors in rendering helpers.

## Migration Goals

- Run all product PoB functionality in the browser with no required backend API.
- Continue with wasmoon Lua 5.4 WASM as the runtime for the first migration phase.
- Preserve key metric parity with desktop PoB for typical builds: attributes, life,
  mana, energy shield, resistances, armour/evasion, primary DPS, and skill DPS.
- Integrate PoB capabilities into the current passive tree application rather than
  rebuilding the full desktop PoB shell.
- Move toward complete PoB capability coverage in phases: import/export, calculation,
  skills, items, config, breakdowns, comparisons, reports, and external-data features
  where feasible in a browser-only model.

## Phased Implementation Plan

### Phase 1: Stabilize Front-End Build

- Restore a clean `npm run build` baseline.
- Add or replace the missing translation loader path used by `treeStore`.
- Add the missing `import.clear` translation key typing and string values.
- Narrow canvas helper context types to explicit 2D contexts.
- Keep this phase focused on build health only; do not change runtime behavior yet.

### Phase 2: Remove Backend Product Dependency

- Remove the Vite `/api` proxy.
- Remove `VITE_CALC_BACKEND_FALLBACK` and backend calculation fallback from the
  front-end client.
- Remove `dev:server` and `test:server` scripts once product code no longer references
  the backend.
- Delete or quarantine `server/` and backend tests after the front-end replacement
  coverage exists.
- Update README to document pure front-end startup and `npm run pipeline:lua` for
  refreshing browser Lua resources.

### Phase 3: Build a PoB Worker Engine Boundary

- Replace the narrow `calculate(xml)` client with a typed `PobEngineClient`.
- Keep one worker-owned PoB build state after `loadBuild`, rather than reloading XML
  for every calculation.
- Define Worker RPC messages for at least:
  - `init`
  - `loadBuild`
  - `exportBuild`
  - `calculate`
  - `getBuildSummary`
  - `setConfig`
  - `listSkills`
  - `updateSkill`
  - `listItems`
  - `updateItem`
- Normalize worker errors, initialization status, request IDs, and crash recovery in
  the TypeScript client.
- Keep current `CalcResult` as the first stable UI contract, while allowing a larger
  raw or sectioned calculation payload for future breakdown panels.

### Phase 4: Lazy-Load the PoB Lua Bundle

- Continue generating `public/pob-lua/manifest.json` with
  `scripts/build_pob_lua_bundle.py`.
- Stop mounting every Lua file before worker initialization.
- Load only `HeadlessWrapper.lua`, `Launch.lua`, and required bootstrap files at
  startup.
- Override or wrap Lua module loading so `LoadModule`, `PLoadModule`, `loadfile`, and
  `require` can fetch and mount files on first use.
- Cache mounted files in the worker so repeated PoB operations do not refetch modules.
- Treat missing files as actionable bundle errors that point to `npm run pipeline:lua`.

### Phase 5: Integrate PoB Features into the Existing UI

- Keep the passive tree as the primary application surface.
- Expand panels incrementally:
  - Build import/export and calculation status.
  - Skill list and selected skill details.
  - Item list, item slots, and item editing/import.
  - Configuration inputs that map to PoB config state.
  - Calculation breakdown and report views.
- Defer external network-backed features such as trade or cloud/archive integrations
  until the browser-only constraints and CORS behavior are explicitly designed.

## Test Plan

- Build health:
  - `npm run build`
  - `npm run test:client-calc`
- API removal checks:
  - `rg "/api|dev:server|VITE_CALC_BACKEND_FALLBACK" src package.json vite.config.ts`
  - Product paths should not depend on `/api` or the Fastify backend.
- Build code coverage:
  - Existing encode/decode round-trip tests continue passing.
  - Add tests that replacing tree XML in a base build preserves skills, items, config,
    and metadata.
  - Add real PoB2 code fixtures covering class, ascendancy, weapon-set nodes, and
    attribute overrides.
- Worker coverage:
  - `init` is idempotent.
  - `loadBuild -> calculate -> exportBuild -> loadBuild -> calculate` keeps key
    metrics stable.
  - Worker crash or initialization failure returns a clear error and allows recovery.
  - Missing bundle files produce actionable errors.
- Parity coverage:
  - Maintain fixture builds for empty, passive-only, skill, item, and config-heavy
    scenarios.
  - Compare key metrics against trusted desktop PoB or previous verified snapshots.
  - Allow small floating-point drift, but fail missing fields or large magnitude
    differences.

## Locked Assumptions

- The migration should remove backend API requirements from product functionality.
- wasmoon Lua 5.4 WASM remains the initial runtime.
- The first correctness target is key metric parity, not full field-by-field parity.
- UI work should extend the current application rather than clone the desktop PoB UI.
- Lua bundle loading should move toward lazy loading to reduce startup cost and memory
  pressure.
- `docs/TASKS.md` should not be updated until this plan is refined into concrete
  implementation tasks.

## Open Decisions

- Exact shape of the Worker RPC TypeScript types and versioning policy.
- Whether `server/` should be deleted immediately after product path removal or kept
  temporarily in a separate comparison/debug location.
- How much raw PoB output should be exposed to React versus converted into explicit
  typed front-end models.
- Which desktop PoB features are browser-feasible without a backend, especially trade,
  cloud/archive, and external API workflows.
- Fixture source of truth for parity testing and how often to refresh it when upstream
  PoB2 changes.
