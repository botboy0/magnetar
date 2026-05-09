# c6 — Handoff

State at end of session 1. Pairs with `c6-travel-map.md`. Pick this up when resuming.

---

## Where we are

**Phase A complete and verified.** Toolchain in hand, fresh love.js + love.wasm built locally and serving from `runtime/vendor/`. Breakout runs against the new build. Negative test confirmed (renamed vendor files → game stuck on "Downloading…" → restored).

Phases B–F (find FPS, write hook, rebuild, wire editor, verify) are not started.

---

## Layout

Build deps live outside the editor repo:

```
C:\Users\Trynda\Desktop\Dev\
  magnetar-editor-v2\           <- editor (this repo)
    runtime\vendor\love.js      <- artifacts copied here
    runtime\vendor\love.wasm
  magnetar-build\               <- everything below is throwaway/rebuildable
    emsdk\                      <- emsdk 4.0.10 (per travel map)
    megasource-web\
      libs\love\                <- this is rozenmad/love-web; patches go here
      libs\zlib-1.3.1\          <- patched (see below)
    love-web-builder\
      build_lovejs.bat          <- patched (see below)
      lovejs_source\compat\     <- build output lands here
```

---

## Patches applied this session

1. `magnetar-build\love-web-builder\build_lovejs.bat`
   - emsdk path → `C:\Users\Trynda\Desktop\Dev\magnetar-build\emsdk\emsdk_env`
   - megasource path → `C:\Users\Trynda\Desktop\Dev\magnetar-build\megasource-web`
   - Generator switched from `Unix Makefiles` to `Ninja` (and `make -j 6` → `ninja`)
   - Added `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` (CMake 4.x dropped support for older `cmake_minimum_required`)

2. `magnetar-build\megasource-web\libs\zlib-1.3.1\CMakeLists.txt`
   - Wrapped the `add_library(zlib SHARED …)` block in `if(NOT EMSCRIPTEN) … endif()`. On Emscripten, only `zlibstatic` is built (with `OUTPUT_NAME z`). Without this, both targets emit `libz.a` and Ninja errors with `multiple rules generate zlib/libz.a`. Megasource already references `zlibstatic`, so nothing else needed.

---

## System-level fixes (one-time, stay fixed)

- **App execution aliases off** for `python.exe` and `python3.exe` (Windows settings → "Aliase für die App-Ausführung"). The Microsoft Store stub was hijacking `python` and breaking emsdk's installer.
- **Removed** `…\WindowsApps\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe` from User PATH — same reason; the package subfolder still had a `python.exe` stub even after the alias toggle.
- **Added** `…\WindowsApps` to User PATH so `winget` is reachable.
- **Installed** CMake 4.3.2 (`Kitware.CMake`) and Ninja 1.13.2 (`Ninja-build.Ninja`) via winget.

---

## Resuming a build

One command from any fresh PowerShell:

```powershell
C:\Users\Trynda\Desktop\Dev\magnetar-build\build.ps1
```

That wrapper activates emsdk env (per-shell), runs `build_lovejs.bat` incrementally, and copies `love.js` + `love.wasm` into `magnetar-editor-v2\runtime\vendor\`. Flags: `-Clean` wipes `build\` first (forces ~25 min full rebuild), `-NoDeploy` skips the copy.

**Don't** delete `build\` between iterations — incremental compile only rebuilds your changes (seconds vs ~25 min full build). The full build was needed once after the zlib patch landed; future hook iterations are cheap.

If you ever need to do it by hand: activate `magnetar-build\emsdk\emsdk_env.ps1`, run `magnetar-build\love-web-builder\build_lovejs.bat`, then copy from `lovejs_source\compat\love.{js,wasm}` into the editor's `runtime\vendor\`.

---

## What's next (per travel map)

**Phase B** — Find FPS in love source:
```bash
grep -r "getFPS" C:\Users\Trynda\Desktop\Dev\magnetar-build\megasource-web\libs\love\src\
```
Expect to land in `src/modules/timer/Timer.cpp`. Note how to access the `Timer` instance (`love::Module::getInstance<Timer>()` or similar).

**Phase C** — Author hook:
- New file `magnetar-build\megasource-web\libs\love\src\magnetar_hooks.cpp`
- Define `EMSCRIPTEN_KEEPALIVE double magnetar_get_fps()` that returns the timer's FPS
- Add the file to `libs\love\src\CMakeLists.txt` alongside an existing `.cpp` (find one in the same dir, copy the pattern)

**Phase D** — Rebuild (incremental, fast).

**Phase E** — Wire editor:
- `runtime\runner.js` `onRuntimeInitialized`: add a `setInterval` polling `Module._magnetar_get_fps()` and posting `{type:'magnetar.status', fps: <value>}`
- `js\main-editor.js`: extend the existing `magnetar.status` handler to read `e.data.fps` and update `#metric-fps` (parallel to the existing `e.data.canvas` branch)

**Phase F** — Verify: open breakout, fps metric updates from `—` to a real number.

---

## Verifying the running build is yours

Hashes alone can't prove "my build" vs "rozenmad's reproducible build" — the bytes are deterministic from same inputs. Three definitive signals:

1. **mtime check** — `ls -la runtime/vendor/love.*` should show the most recent build timestamp.
2. **Negative test** — rename `love.js` → `love.js.bak`, hard reload, see "Downloading…" hang, restore. (Used this session to confirm load path.)
3. **Symbol check** *(only after Phase D)* — `strings runtime/vendor/love.wasm | grep magnetar` will print `magnetar_get_fps`. This is the strongest proof and arrives for free with the hook.

---

## Gotchas worth remembering

- emsdk activate via `.bat` doesn't propagate env to PowerShell — use `.\emsdk_env.ps1`.
- `.bat` `mkdir` warnings about existing dirs on rebuild are harmless.
- harfbuzz prints ~20 `[-Wnontrivial-memcall]` warnings during compile. Upstream noise, ignore.
- The CMake "Compatibility with CMake < 3.10 will be removed" warning is also harmless for now.
- If `cmake` regenerates and complains about generator mismatch, blow away `build\` and let it reconfigure from scratch.
