# c6 — love-web Fork Travel Map

A loose guide for the day's work on c6: forking rozenmad's love-web build pipeline, authoring the first hook (FPS), wiring it through to the editor.

Not a checklist — context and concepts so the unfamiliar parts feel less unfamiliar. Skim once before starting, refer back when something surprises you.

---

## The lay of the land

Three rozenmad repos collaborate to produce `love.js` + `love.wasm`. Knowing which does what saves time when something breaks.

**`rozenmad/love-web-builder`** — the orchestrator. Contains `build_lovejs.bat`, the single script you actually run. Has paths in it you'll edit to point at your local emsdk and your local megasource-web checkout. Its `lovejs_source/compat/` directory is *where the artifacts land* when the build succeeds — that's the directory you'll then copy into `magnetar-editor-v2/runtime/vendor/`. Also contains `build.bat` and `build.py` for *packaging user games* — those are unrelated to engine building, ignore them for c6.

**`rozenmad/megasource-web`** — the dependency bundle. Provides SDL3, OpenAL, FreeType, glslang, harfbuzz, all the C/C++ libraries LÖVE needs, pre-configured for Emscripten. You don't modify this. You `git clone` it, `cd` into it, and clone love-web *inside* it at `libs/love`.

**`rozenmad/love-web`** — the actual LÖVE source you'll patch. This is where hooks go. Pinned by rozenmad to LÖVE 12 commit `cdf68b3`. Lives *inside* `megasource-web/libs/love/` because that's how megasource expects to find it.

So the layout you build is:

```
emsdk/                    <- separate, set up once
megasource-web/
  libs/
    love/                 <- this is rozenmad/love-web; this is what you patch
love-web-builder/         <- contains build_lovejs.bat which orchestrates the build
  lovejs_source/compat/
    love.js               <- output lands here
    love.wasm             <- and here
```

**Caveat about the README's flow.** It says "modify the paths in `build_lovejs.bat`" twice — once before cloning megasource and once after. Not a typo, but it could read as one. The single edit is: open `build_lovejs.bat`, point its `EMSDK_PATH` and `MEGASOURCE_PATH` (or whatever the variables are named) at where you actually put those things. Done once, before you build.

---

## What emsdk actually is

emsdk is a meta-installer: it downloads pinned versions of `emcc` (the Emscripten compiler frontend) plus a Node, plus the right LLVM, plus tooling, into a self-contained directory. After `emsdk activate 4.0.10`, you `source ./emsdk_env.sh` (or run `emsdk_env.bat` on Windows) and your shell now has `emcc`, `em++`, `emcmake`, `emmake` on its PATH. *It does not install system-wide.* It's a sandbox — closing the shell unsets the env. That's good for you: it means broken state is one shell-restart away from gone.

Pin **exactly 4.0.10** as the README says. emsdk version drift is the single most common failure mode for projects like this. Don't take the latest just because.

---

## What `emcmake` and `emmake` do

`emcmake cmake ...` is `cmake ...` with all the right flags pre-set to target Emscripten instead of native. It tells CMake "the compiler is `emcc`, the target is wasm, the system is browser-shaped." You'll likely never invoke it directly because rozenmad's `.bat` script does it for you — but knowing this is what's underneath helps you read the script.

`emmake make` is the same idea for `make`. Wraps `make` with Emscripten environment.

Same `cmake -B build && cmake --build build` rhythm you know from native CMake builds, just with `emcmake` in front.

---

## The build pipeline at the highest level

What `build_lovejs.bat` does, conceptually:

1. Sources emsdk env so `emcc` is available.
2. Runs `emcmake cmake` against megasource-web, which configures LÖVE + all dependencies as a single CMake project targeting wasm.
3. Runs `emmake make -j` (or ninja) to compile everything. *This is the long step.* Tens of minutes the first time. It's compiling SDL3, OpenAL, FreeType, glslang, harfbuzz, libpng, zlib, theora, vorbis, ogg, modplug, *and* LÖVE. Subsequent builds are much faster because of incremental compilation — only changed files recompile.
4. Emscripten links it all into `love.js` (the JS shim) and `love.wasm` (the binary).
5. The script copies those into `lovejs_source/compat/`.

If a step fails, you'll know which: CMake errors are configuration-time, `make`/`ninja` errors are compile-time, link errors come at the end. Different errors, different fixes.

---

## WASM concepts that actually matter for hooks

You'll hit five Emscripten concepts when authoring a hook. The mental model:

### 1. The boundary is a thin function-call interface

WASM/JS interop is just function calls in both directions. C calls JS, JS calls C. Both sides have to agree on names and types. Unlike native FFI, there's no shared pointer-to-string magic — strings get copied, pointers are integers into a shared `HEAPU8` array.

### 2. Dead-code elimination will silently drop your hook

Emscripten aggressively strips C functions that aren't reachable from `main`. If you write a hook function but nothing in C calls it, it vanishes. Two ways to keep it alive:

- Add it to `EXPORTED_FUNCTIONS` (a linker flag, list of underscore-prefixed names like `["_main", "_magnetar_get_fps"]`).
- Or use `EMSCRIPTEN_KEEPALIVE` macro on the function definition — same effect, lives in the C code.

For c6, `EMSCRIPTEN_KEEPALIVE` is cleaner because the change lives next to the code, not in a build flag.

### 3. EM_JS vs EM_ASM vs exported C functions

Three ways to cross the boundary. Pick the right one:

- **EM_JS** — declare a JS-implemented function inside a C file, callable from C. Shaped like: "I'm in C, I want to call out to JS to do X." Use this for *engine-push* (engine notifies the editor).
- **EM_ASM** — inline JS code in the middle of a C function. Same direction as EM_JS but no reusable wrapper. Use for one-off side effects.
- **Exported C function (EMSCRIPTEN_KEEPALIVE)** — a normal C function, callable from JS via `Module._function_name()` or `Module.ccall()`. Shaped like: "I'm in JS, I want to call into C to ask X." Use this for *engine-pull* (editor asks engine for a value).

For FPS specifically, *exported C function* is right. The runner's JS-side polling logic stays in JS, where it already lives; the C side just exposes one synchronous "what's the current FPS" call.

The simplest possible FPS hook is conceptually:

```c
// somewhere in love-web/src that gets compiled in
#include <emscripten.h>
extern double love_get_fps_internal(); // whatever LÖVE already has internally

EMSCRIPTEN_KEEPALIVE
double magnetar_get_fps() {
    return love_get_fps_internal();
}
```

Then in `runner.js`:

```js
const fps = Module._magnetar_get_fps();
// post via existing magnetar.status channel
```

The actual C side will be slightly different — finding *what* internal function or struct exposes FPS in LÖVE's source is the real task. But the pattern is right.

### 4. Underscore prefix on exports

C function `magnetar_get_fps` becomes JS-side `Module._magnetar_get_fps`. Emscripten convention. Trips people up exactly once.

### 5. The hook needs to find LÖVE's actual FPS data

LÖVE 12's `love.timer.getFPS()` is implemented somewhere in `src/modules/timer/`. You'll grep for `getFPS`, find the C function, see how it computes the value, and either call it directly from your hook or replicate the calculation. Cursor / Claude Code helps a lot here — point it at `libs/love/src/` and ask "where is FPS calculated, and what's the cleanest way to expose it via EMSCRIPTEN_KEEPALIVE."

---

## What a "patch" actually means here

You're not making a separate `.patch` file unless you want to. The simplest workflow:

- Clone `rozenmad/love-web` into `megasource-web/libs/love/`.
- Initialize it as your own git repo (or push it as `magnetar/love-web` to your forge).
- Make your changes as normal commits on a Magnetar branch.
- When rozenmad updates upstream, fetch their changes and rebase your branch.

That's it. The "fork" is your branch in your repo with their commits as ancestors.

For c6 today: you don't need a forge yet. Make your changes locally, get the build working, commit them. Push to a forge later when you've decided GitHub vs Codeberg.

---

## Concrete sequencing for the day

Intentionally loose. Adjust as you go.

### Phase A — get a stock build

Clone the three repos per the README. Install emsdk 4.0.10. Edit `build_lovejs.bat` paths. Run it. Wait. If it works, you have stock `love.js` + `love.wasm` in `lovejs_source/compat/`.

**Verify by copying them into `magnetar-editor-v2/runtime/vendor/` and running breakout — should run identically to today.**

This is the semi-win line.

### Phase B — find FPS in LÖVE source

```bash
grep -r "getFPS" libs/love/src/
```

Should land you in something like `src/modules/timer/Timer.cpp` or similar. Read the function. Note that it's a member function on a `Timer` class — your hook needs access to a `Timer` instance, which means going through `love::Module::getInstance<Timer>()` or however LÖVE exposes module access. (Cursor's *real* job today: read these surrounding files, give you the exact lookup pattern.)

### Phase C — author the hook

Add the `EMSCRIPTEN_KEEPALIVE`-decorated function somewhere in `libs/love/src/`. A new file is cleaner than modifying existing ones — call it `src/magnetar_hooks.cpp` or similar. Add it to whatever CMakeLists.txt enumerates source files (greppable: find an existing `.cpp` in the same dir, find where its name appears, add yours next to it).

### Phase D — rebuild

Re-run `build_lovejs.bat`. Should be much faster than the first build because of incremental compilation. Most files don't recompile.

### Phase E — wire the editor

In `runner.js`, add to `onRuntimeInitialized` (after the canvas-reporting block): a `setInterval` that calls `Module._magnetar_get_fps()` and posts `{type: 'magnetar.status', fps: <value>}`. In `main-editor.js`, the existing message handler already has a section for `e.data.canvas`; add a parallel section for `e.data.fps` that updates `metricFps`. Get the element ref (`document.getElementById('metric-fps')`), set its `textContent` to the formatted value.

### Phase F — verify

Run the editor. Open breakout. The fps metric updates from `—` to a real number.

---

## Things that will probably surprise you

**The first build is *long*.** Compiling SDL3 + harfbuzz + glslang + LÖVE in WASM takes real time. Don't think it's hung at 30 minutes. Open a second terminal, look at CPU, watch for output. ninja or `make -j` should be using all your cores.

**Linker errors at the end of a 40-minute build.** Worst failure mode emotionally. If you get one, the message will name a missing symbol — usually means an `EXPORTED_FUNCTIONS` flag is wrong, or a header is missing an `extern "C"` block, or a CMakeLists.txt didn't get updated to include your new source file. Don't repeat the full build to debug — make the fix, re-run, ninja/make will only relink (seconds, not minutes).

**The .bat file is Windows-cmd syntax.** If you're building under WSL, you'll likely want to translate `build_lovejs.bat` to a `.sh` script. Mostly mechanical: `set VAR=value` → `export VAR=value`, `%VAR%` → `$VAR`, drop the `call` statements. The actual cmake/make invocations in the middle work as-is.

**`emsdk_env.bat` vs `emsdk_env.sh`.** Use the right one for your shell. WSL bash → `.sh`. Windows cmd → `.bat`.

**LÖVE-on-WASM quirks.** rozenmad's notes mention some LÖVE features behave differently in the WASM build (threading, FFI, audio streaming). Likely irrelevant for hook-writing but worth knowing if anything weird shows up.

---

## What you don't need today

Skip all of these for c6:

- A separate fork repo on a forge. Local-only is fine until end of day.
- A patch file. Commits-on-a-branch is fine.
- An automated build script. The .bat already orchestrates the build; "automated" for c6 means "I run one command and the artifacts land where I need them," which the .bat already does.
- CI / GitHub Actions builds. Tomorrow's problem if at all.
- A second hook. FPS first. Errors and others can wait.
- A renamed export prefix scheme. `_magnetar_get_fps` is fine for one hook; if the pattern grows, you can rename later.

---

## End-of-day check

Three outcomes, three reads:

- **Stock build works, FPS hook works, editor metric updates** → full win. PROJECT.md gets edited to match reality (now backed by code). c6 is real.
- **Stock build works, no hook yet** → semi-win. Toolchain is in your hands. Hook authoring is a follow-up session, not an unknown.
- **Stock build doesn't work** → loss. Document what blocked you, decide tomorrow whether to push or fall back to Option 4.

---

## Learning resources

Curated, in order of when you'll need them. Read what you don't already know; skip what you do.

### rozenmad's specific repos (canonical for the build itself)

- **love-web-builder README** — <https://github.com/rozenmad/love-web-builder> — the canonical instructions. The "Building LÖVE from Source" section at the bottom is what you'll actually follow.
- **love-web** — <https://github.com/rozenmad/love-web> — the LÖVE source you'll be patching. Worth a quick browse to see the layout under `src/modules/`.
- **megasource-web** — <https://github.com/rozenmad/megasource-web> — the dependency bundle. You won't modify this; just clone it.

### Emscripten — toolchain setup

- **emsdk repo** — <https://github.com/emscripten-core/emsdk> — install instructions for your platform. The `emsdk install <version>` and `emsdk activate <version>` commands are documented in the README.
- **Getting Started** — <https://emscripten.org/docs/getting_started/downloads.html> — official setup guide. Skim if emsdk install hits any platform-specific snag.

### Emscripten — the interop concepts (the WASM-specific gap)

This is the section to read if anything in the "WASM concepts that actually matter for hooks" feels fuzzy.

- **Interacting with code** — <https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html> — *the* canonical page on EM_JS, EM_ASM, EXPORTED_FUNCTIONS, ccall, cwrap. Read at least the first half once. It's the single best return on time for the day.
- **emscripten.h API reference** — <https://emscripten.org/docs/api_reference/emscripten.h.html> — reference for `EMSCRIPTEN_KEEPALIVE` and the macros. Skim, then refer back when you're authoring.
- **Building Projects** — <https://emscripten.org/docs/compiling/Building-Projects.html> — covers `emcmake`, `emmake`, and how Emscripten plugs into CMake-based builds. Useful if the build script does something you want to understand rather than just run.

### LÖVE — source orientation

You'll only spend a short time inside LÖVE itself, but a quick orientation helps:

- **love2d/love** — <https://github.com/love2d/love> — upstream. The `src/modules/` directory layout matches what rozenmad ships at commit `cdf68b3`. Browse `src/modules/timer/` first; that's where `getFPS` lives.
- **Building LÖVE wiki page** — <https://love2d.org/wiki/Building_L%C3%96VE> — useful for context on LÖVE's normal build structure and SDL3/megasource conventions, even though you're targeting WASM rather than native.

### Lower-priority, useful only if a specific thing breaks

- **Emscripten file system overview** — <https://emscripten.org/docs/api_reference/Filesystem-API.html> — only relevant if you change how the runtime injects user files (you probably won't for c6).
- **WebAssembly in Action — EM_JS macros chapter** — <https://livebook.manning.com/book/webassembly-in-action/c-emscripten-macros/v-7> — if the canonical Emscripten docs feel terse, this book chapter is a friendlier intro to the same material.
- **Calling JavaScript from C/C++ via WebAssembly (Medium)** — <https://ihsavru.medium.com/calling-javascript-code-from-c-c-using-webassembly-a9445c11bc6d> — practical short-form walkthrough of the same EM_JS/EM_ASM concepts.

### Reference for things you already know but might want to double-check

- **CMake docs** — <https://cmake.org/documentation/> — only if a CMakeLists.txt edit doesn't behave.
- **GNU Make manual** — <https://www.gnu.org/software/make/manual/> — only if `emmake` does something surprising.

---

## Quick "I'm stuck" triage

If something breaks, locate it on this list before going deep:

- **emsdk command not found** → didn't source `emsdk_env.sh` / `emsdk_env.bat` in the current shell. emsdk is per-shell.
- **CMake error during configure** → usually a missing dependency or wrong path in the .bat. Read the error; megasource is supposed to bundle everything, so if a dep is "missing," the megasource clone is incomplete or `libs/love` wasn't placed correctly.
- **Compile error mid-build** → likely your patch's syntax. Make-incremental, fix, retry.
- **Link error at end of build** → an exported symbol can't be found. Check `EMSCRIPTEN_KEEPALIVE` is on the function, the file is in CMakeLists.txt, and the source file is `.cpp` (not `.c`) if you're using C++ features.
- **Build succeeds, breakout doesn't run** → diff your `love.js` + `love.wasm` against the originals (or just file size — if dramatically smaller, dead-code-elimination ate your hook because it's unreachable from C; KEEPALIVE missing or misspelled).
- **`Module._magnetar_get_fps is not a function`** → JS side can't see the export. KEEPALIVE missing, or you forgot the underscore prefix on the JS side.

Good luck.
