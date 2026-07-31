# PoB Lua Runtime

SuperPoE desktop calculations use one persistent LuaJIT sidecar. The renderer
communicates with it through Electron IPC; the main process uses JSON Lines over
the sidecar's standard input and output. Initialization starts asynchronously
when Electron is ready and does not block the first window.

## Version Contract

`pob-runtime.lock.json` is the source of truth for:

- the PathOfBuilding-PoE2 repository commit and release version;
- the normalized SHA-256 of every included upstream Lua source file;
- the LuaJIT source commit used for our native binaries;
- the sidecar protocol version.

The current PoB snapshot is release 0.23.0 at commit
`99bc6e107fd36ae541b349fc36a44281cb371313`. Its 1057 included Lua source
files match the upstream commit after normalizing line endings.

PoB2 commits a prebuilt Windows `lua51.dll` but does not publish the LuaJIT
source revision used for that DLL. We therefore cannot claim binary identity
with PoB2. We guarantee LuaJIT/Lua 5.1 language semantics, run with `jit.off()`,
and pin our reproducible LuaJIT build to the commit recorded in the lock file.

## Build And Verification

```text
npm run pipeline:lua      regenerate the browser/native PoB bundle
npm run verify:lua        verify the committed bundle and native runtime hashes
npm run verify:lua:upstream also require the local PoB checkout to match the lock
npm run native:lua        build LuaJIT for the current OS and architecture
npm run test:native:lua   calculate the committed Stormweaver fixture
npm run prepare:native:lua ensure a binary exists, then run the fixture
```

`npm run dist:electron` runs `prepare:native:lua` first. A local package cannot
be produced silently without a working sidecar. Verified Windows x64 and macOS
Apple Silicon binaries under `native/bin/` are committed so normal packaging
does not require a native compiler toolchain.

### Rebuilding the prebuilt runtimes

Normal development and packaging only require the committed runtime for the
target platform. The following toolchains are required only when intentionally
updating the pinned LuaJIT commit or rebuilding its checked-in binaries.

Windows x64 uses one of these toolchains:

- Visual Studio 2022 Build Tools with the C++ x64 workload; or
- a portable w64devkit installation selected with `W64DEVKIT_ROOT`.

```powershell
$env:W64DEVKIT_ROOT = 'D:\tools\w64devkit'
npm.cmd run native:lua
npm.cmd run test:native:lua
```

macOS Apple Silicon requires Git, Xcode Command Line Tools, and `make`. Intel
Macs are not a supported build or distribution target:

```bash
xcode-select --install
npm run native:lua
npm run test:native:lua
```

Linux desktop packaging is intentionally out of scope. The browser Wasmoon
runtime remains platform-independent for renderer development.

The build script always checks out the LuaJIT commit from
`pob-runtime.lock.json`. It writes only the current host architecture:

```text
native/bin/win32-x64/luajit.exe
native/bin/win32-x64/lua51.dll
native/bin/darwin-arm64/luajit
```

## GitHub Actions

Both `.github/workflows/build-dev.yml` and `.github/workflows/release.yml`
build two independent packages:

| Job | Runner | Required `process.arch` | Package |
| --- | --- | --- | --- |
| Windows x64 | `windows-latest` | `x64` | NSIS |
| macOS Apple Silicon | `macos-15` | `arm64` | DMG and ZIP |

Each job performs this release gate:

1. Verify the actual runner architecture.
2. Verify the pinned PoB bundle and both checked-in runtime hashes.
3. Verify the checked-in runtime for the current platform and architecture.
4. Run the native Stormweaver calculation fixture.
5. Build and package Electron with only the matching platform runtime.

The fixture must initialize the JSON Lines protocol and calculate level,
class, ascendancy, allocated nodes, and mana. A missing binary, wrong
architecture, protocol mismatch, or calculation failure stops publication.

Packaged resources are located at:

```text
resources/pob-lua-runtime/<platform>-<architecture>/
resources/pob-lua-sidecar/pob-lua-runner.lua
resources/pob-lua/
```

Only the matching native directory is included in each package:

| Client | Executable |
| --- | --- |
| Windows x64 | `resources/pob-lua-runtime/win32-x64/luajit.exe` with `lua51.dll` |
| macOS Apple Silicon | `resources/pob-lua-runtime/darwin-arm64/luajit` |

## Client Invocation Flow

Windows and macOS use the same application protocol; only the executable path
and native loader format differ.

1. The renderer calls `calculateBuild` or `rankSkillsByEffectiveDps` in
   `src/engine/pobLuaClient.ts`.
2. Electron preload exposes `window.pob2Desktop` and forwards the request over
   `pob2:lua-init`, `pob2:lua-calculate`, or `pob2:lua-rank-skills` IPC.
3. The main process delegates the request to the singleton `PobLuaService`.
4. `PobLuaService` resolves the platform-specific executable plus the shared
   `pob-lua-runner.lua` and `pob-lua` bundle, then starts one persistent child
   process.
5. Windows starts `luajit.exe`; the adjacent `lua51.dll` supplies the runtime.
   macOS starts the executable `darwin-arm64/luajit`, which links only the macOS
   system library.
6. The sidecar writes a JSON Lines `ready` message with protocol version `1`.
   The main process then sends request IDs, operation names, and payloads over
   stdin and receives structured responses over stdout.
7. Results return through Electron IPC to the renderer. If initialization or a
   request fails, full calculations and skill ranking fall back to the Wasmoon
   worker for the remainder of that session.

Development uses the same layout under the repository root (`native/bin/`,
`native/pob-lua-runner.lua`, and `public/pob-lua/`). Packaged clients resolve
the equivalent files relative to Electron's `process.resourcesPath`.

To update PoB2, update the upstream snapshot and lock together, regenerate the
bundle, review intended fixture changes, and commit them atomically. The bundle
pipeline rejects a source snapshot whose normalized hash does not match the
lock.

To update LuaJIT, change only the locked commit first, build each runtime on its
matching pinned CI platform, run the native fixture, and commit the binaries
together with their size and SHA-256 entries in `pob-runtime.lock.json`. Do not
copy an unverified third-party binary into a release.

## Failure Behavior

The committed PoB bundle remains byte-for-byte upstream source. The Wasmoon
worker applies its `TradeHelpers.lua` Lua 5.4 compatibility replacements only
to the in-memory source immediately before mounting it; the native sidecar
never sees those replacements.

The desktop app prefers LuaJIT for full build calculations. If the native
binary is absent, cannot initialize, crashes, or fails IPC, the renderer falls
back to the existing persistent Wasmoon worker. Equipment modifier inspection
continues to use Wasmoon for now; moving it to the native protocol is a separate
change so its larger serialization contract can be tested independently.

## Troubleshooting

- `Visual Studio C++ Build Tools or W64DEVKIT_ROOT is required`: install the
  Windows C++ workload or point `W64DEVKIT_ROOT` at a portable w64devkit root.
- `LuaJIT protocol mismatch`: the runner and Electron service protocol versions
  differ; update them together with `pob-runtime.lock.json`.
- `PoB source snapshot mismatch` from `verify:lua:upstream`: the files under
  `upstreams/` do not represent the locked PoB commit. Regular `verify:lua`
  validates the committed bundle without requiring the local upstream checkout
  to remain pinned.
- Native startup failure in development: inspect the main-process line prefixed
  with `[PoB LuaJIT]`; the renderer will use Wasmoon for that session.
- macOS execution denial: confirm the `luajit` file retained executable mode and
  is included in signing/notarization resources.
