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
```

CI builds three independent packages: Windows x64, macOS Intel x64, and macOS
Apple Silicon arm64. Each job compiles LuaJIT from the locked source commit and
runs the sidecar fixture before packaging.

To update PoB2, update the upstream snapshot and lock together, regenerate the
bundle, review intended fixture changes, and commit them atomically. The bundle
pipeline rejects a source snapshot whose normalized hash does not match the
lock.

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
