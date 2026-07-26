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
npm run verify:lua        verify the source snapshot and every bundle hash
npm run native:lua        build LuaJIT for the current OS and architecture
npm run test:native:lua   calculate the committed Stormweaver fixture
npm run prepare:native:lua ensure a binary exists, then run the fixture
```

`npm run dist:electron` runs `prepare:native:lua` first. A local package cannot
be produced silently without a working sidecar. Native binaries under
`native/bin/` are build artifacts and are not committed.

### Local prerequisites

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
2. Restore a LuaJIT cache keyed by OS, architecture, lock file, and build script.
3. Verify the pinned PoB source and bundle hashes.
4. Build LuaJIT on a cache miss.
5. Run the native Stormweaver calculation fixture.
6. Build and package Electron with the matching native resources.

The fixture must initialize the JSON Lines protocol and calculate level,
class, ascendancy, allocated nodes, and mana. A missing binary, wrong
architecture, protocol mismatch, or calculation failure stops publication.

Packaged resources are located at:

```text
resources/pob-lua-runtime/<platform>-<architecture>/
resources/pob-lua-sidecar/pob-lua-runner.lua
resources/pob-lua/
```

To update PoB2, update the upstream snapshot and lock together, regenerate the
bundle, review intended fixture changes, and commit them atomically. The bundle
pipeline rejects a source snapshot whose normalized hash does not match the
lock.

To update LuaJIT, change only the locked commit first, build and run the native
fixture on both CI jobs, and then review the produced package. Do not copy
an untracked third-party binary into a release.

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
- `PoB source snapshot mismatch`: the files under `upstreams/` do not represent
  the locked PoB commit. Do not regenerate the bundle until they match.
- Native startup failure in development: inspect the main-process line prefixed
  with `[PoB LuaJIT]`; the renderer will use Wasmoon for that session.
- macOS execution denial: confirm the `luajit` file retained executable mode and
  is included in signing/notarization resources.
