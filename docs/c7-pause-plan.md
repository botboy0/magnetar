# c7 — Engine-level Pause/Resume

A plan for adding a true "stop time" pause to the Magnetar preview, where the
running game freezes as if a machine had stopped time outside it: dt does not
accumulate, audio stops, fps continuity is preserved on resume, and no real
time has passed in the simulation's frame of reference.

This builds on c6 (the love-web fork toolchain). Cost: one Lua patch, one
C++ hook addition, one editor JS commit, one PROTOCOL.md addendum, one
incremental rebuild.

---

## Decision summary

Three shapes were considered. We ruled out:

- **JS-side perception pause** (hide canvas, keep loop running). Pretends to
  pause; `t` keeps advancing, audio keeps playing. Cheap but dishonest.
- **B-shallow** (a C++ flag that Lua's `love.run` reads). No more robust than
  a Lua-only shim, since the gate still lives in `callbacks.lua` either way.
- **B-deep** (gate the dispatch of `love.update` from C++). Investigated and
  found not to exist: `love.update` is dispatched purely from Lua inside the
  inner closure of `love.run` (`callbacks.lua:165-211`). There is no C++ site
  to wrap. C++ only drives `lua_resume` on the boot coroutine.

What we land on instead is a hybrid that takes the cleaner-than-expected
parts of "pause the whole love.js module":

- **Main loop** is paused via Emscripten's built-in `Module.pauseMainLoop()` /
  `Module.resumeMainLoop()`. These are already exported in the love.js shim
  (verified — `Module["pauseMainLoop"]=MainLoop.pause` is in the existing
  vendor build), so this part needs **zero engine changes**.
- **Audio** is paused via a small new C++ hook that calls `Audio::pause()`
  (which returns a `std::vector<Source*>` of what was paused) and resumes
  via `Audio::play(those_sources)`. This is necessary because pausing the
  main loop does NOT stop currently-playing Web Audio nodes — they run on
  their own browser thread independent of the wasm runtime.
- **Timer dt continuity on resume** is handled by calling
  `love::timer::Timer::step()` once on resume and discarding the result.
  Without this, the next real `step()` call inside `love.run` would
  measure the entire pause duration as one giant `dt`, teleporting
  physics. With this, dt continuity is preserved exactly as we want.

No `callbacks.lua` patch. No `/magnetar_paused` FS flag. The whole feature
lives at the Module / C++ boundary.

---

## What we verified before writing this plan

These facts were established by reading the source you uploaded
(`megasource-web/libs/love/src/`) and the vendored `love.js`:

1. **`love.run` is in Lua, in `modules/love/callbacks.lua:165-211`.** It
   is the only caller of `love.update` and `love.draw`. There are no C++
   callsites for either callback (greppable: `"update"` and `"draw"` only
   appear as method names on bound types like Box2D World and ParticleSystem,
   not the global callbacks).

2. **`Audio::pause()` (no args) is a virtual method on the Audio module
   base class** (`modules/audio/Audio.h:164`). Returns
   `std::vector<Source*>` of the sources it paused — exactly what we need
   for selective resume. Counterpart `Audio::play(const std::vector<Source*>&)`
   takes that list and resumes only those. Sources the user paused
   themselves stay paused, which is correct.

3. **`Audio::pauseContext()` exists** (`Audio.h:298`) and on non-Android
   non-OpenAL-Soft platforms calls `alcMakeContextCurrent(nullptr)`
   (`openal/Audio.cpp:359-378`). HOWEVER, audio in this build flows
   through SDL3's `AudioContext` (`Module["SDL3"].audioContext` — visible
   throughout the love.js shim), not just OpenAL's. `pauseContext()` may
   not catch SDL3-driven audio. **`Audio::pause()` is the safer pick**
   because it pauses at the source level regardless of which backend the
   shim routed the audio through.

4. **`Module.pauseMainLoop` / `Module.resumeMainLoop` are exposed** in the
   existing love.js shim (search the file for `Module["pauseMainLoop"]=MainLoop.pause`
   — present unconditionally near the bottom of the bootstrap). No
   rebuild needed for the main-loop part.

5. **Pthreads are NOT enabled in this build.** No `-pthread`, no
   `USE_PTHREADS`, no `PTHREADS` flag in `megasource-web/CMakeLists.txt`.
   This means the OpenAL `PoolThread` (`openal/Audio.cpp`) is dead code on
   wasm — there is no real thread spinning during pause that could leak
   simulation time. Documented limitation: if pthreads are enabled in a
   future build, this plan needs a re-read.

6. **`Module._magnetar_get_fps` is the only existing Magnetar export.**
   We follow its exact pattern (`magnetar_hooks.cpp:14-24`).

---

## Patch 1 — engine: add `magnetar_pause` and `magnetar_resume`

**File:** `megasource-web/libs/love/src/magnetar_hooks.cpp`

Add two new exports next to `magnetar_get_fps`. The pause hook captures the
list of audio sources that were actually playing (so resume only restarts
those and leaves user-paused sources alone). State is held in a file-local
`std::vector` since this is a single-game-instance runtime.

```cpp
// existing includes stay
#include "common/Module.h"
#include "modules/timer/Timer.h"
#include "modules/audio/Audio.h"     // NEW
#include "modules/audio/Source.h"    // NEW
#include <vector>                    // NEW

namespace {
    // Sources paused by magnetar_pause(). On resume we play exactly these
    // back, so user-paused sources are not accidentally restarted.
    // File-local because the runner is a single-game-instance harness;
    // no concurrent pause calls are possible.
    std::vector<love::audio::Source*> g_paused_sources;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
int magnetar_get_fps()
{
    love::timer::Timer *t = love::Module::getInstance<love::timer::Timer>(love::Module::M_TIMER);
    if (!t) return -1;
    return t->getFPS();
}

// Freeze game time. Called from the editor before Module.pauseMainLoop().
// Pauses all currently-playing audio sources and returns. Idempotent: if
// already paused, the second call is a no-op (g_paused_sources stays as-is).
EMSCRIPTEN_KEEPALIVE
void magnetar_pause()
{
    if (!g_paused_sources.empty()) return; // already paused

    love::audio::Audio *a = love::Module::getInstance<love::audio::Audio>(love::Module::M_AUDIO);
    if (a) {
        // Audio::pause() pauses everything currently playing and returns
        // the list. We retain it so resume can restart exactly those.
        g_paused_sources = a->pause();
    }
    // Note: main-loop pause itself is initiated by the editor via
    // Module.pauseMainLoop() — this hook only handles the parts that
    // can't be done from JS (audio + timer step-discard).
}

// Resume game time. Called from the editor AFTER Module.resumeMainLoop().
// Order matters: resume the loop first so love.run is ready to advance,
// then call this to resume audio and discard the accumulated dt.
EMSCRIPTEN_KEEPALIVE
void magnetar_resume()
{
    // 1. Discard the wall-clock gap accumulated during pause. This is
    //    the dt-continuity step. The next love.timer.step() call inside
    //    love.run will return a small, sane dt instead of the full pause
    //    duration. Without this, physics teleports through walls on resume.
    love::timer::Timer *t = love::Module::getInstance<love::timer::Timer>(love::Module::M_TIMER);
    if (t) t->step(); // result deliberately discarded

    // 2. Resume the audio sources we paused. User-paused sources stay
    //    paused because they're not in our list.
    if (!g_paused_sources.empty()) {
        love::audio::Audio *a = love::Module::getInstance<love::audio::Audio>(love::Module::M_AUDIO);
        if (a) a->play(g_paused_sources);
        g_paused_sources.clear();
    }
}

} // extern "C"
```

Why these specific includes:
- `audio/Audio.h` for the `Audio` module base class with `pause()` / `play()`.
- `audio/Source.h` for the `Source*` element type of the vector.
  (Confirmed `Source` is a complete type via this header — same pattern
  the engine uses internally.)
- `<vector>` for the holding container.

---

## Patch 2 — editor: wire the pause button

**File:** `editor.html`

Add an id and `aria-pressed` attribute to the existing pause button (currently
inert at `editor.html:142-144`):

```html
<button class="btn-icon" id="btn-pause" title="Pause" aria-pressed="false">
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/></svg>
</button>
```

(Keep the existing svg children — only the id and aria-pressed attributes are new.)

**File:** `js/main-editor.js`

Add a new section after the existing fullscreen wiring (~line 600). The
pattern follows the existing restart/fullscreen blocks for consistency.

```javascript
/* ---------- Pause button (c7) ----------
   Engine-level pause: stops the main loop, pauses audio, and on resume
   discards the accumulated wall-clock gap so dt continuity is preserved.
   The visual experience: time freezes inside the running game; resuming
   continues exactly where it left off, no physics teleport, no audio
   click, no FPS-counter discontinuity.

   Three things have to happen in order on each transition because
   pauseMainLoop alone doesn't stop audio (Web Audio nodes run on their
   own thread, independent of the wasm runtime), and resuming the loop
   before discarding the timer gap means love.run sees a giant dt on its
   next step. The Module._magnetar_pause / _magnetar_resume hooks handle
   the audio + timer parts; pauseMainLoop / resumeMainLoop handle the
   loop itself.

   State is local: paused vs not. We don't read it back from the runner
   because the source of truth is the editor's intent — the runner just
   reflects it. If the iframe reloads (a fresh Run), state resets to
   unpaused naturally because the new Module starts unpaused. */
const pauseBtn = document.getElementById('btn-pause');
let isPaused = false;

function setPauseState(paused) {
  if (!previewFrame || !previewFrame.contentWindow) return;
  const M = previewFrame.contentWindow.Module;
  // Guard: if Module isn't ready yet (pre-boot click), no-op. Pause
  // before boot has nothing to pause anyway.
  if (!M || typeof M._magnetar_pause !== 'function') return;

  if (paused) {
    // Pause audio first (handles state we can't reach from JS), THEN
    // halt the main loop. The order matters because pauseMainLoop stops
    // the wasm runtime from running anything more — including our hook
    // — so the hook has to fire before the loop stops.
    M._magnetar_pause();
    if (typeof M.pauseMainLoop === 'function') M.pauseMainLoop();
  } else {
    // Resume the loop FIRST so love.run is ready to advance, THEN call
    // resume to discard the accumulated dt and restart audio. Reverse
    // order would mean magnetar_resume calls Timer::step() while the
    // loop is still paused — the step still works (it's just a clock
    // read) but the value would be slightly wrong by one frame's worth
    // of additional pause. Doing resume after un-pausing the loop keeps
    // the discard tight.
    if (typeof M.resumeMainLoop === 'function') M.resumeMainLoop();
    M._magnetar_resume();
  }

  isPaused = paused;
  if (pauseBtn) pauseBtn.setAttribute('aria-pressed', String(paused));
  // Optional: swap glyph here. For c7 we keep the pause-bars glyph
  // permanent and let aria-pressed drive any styling differences.
}

if (pauseBtn) {
  pauseBtn.addEventListener('click', () => setPauseState(!isPaused));
}

/* When the iframe reloads (fresh Run), the new Module starts unpaused.
   Reset our local state so the button reflects reality. The existing
   runProject() flow doesn't need changes — runs always go through
   iframe.src= which discards the old window.Module entirely. */
function resetPauseStateForFreshRun() {
  isPaused = false;
  if (pauseBtn) pauseBtn.setAttribute('aria-pressed', 'false');
}
```

Hook `resetPauseStateForFreshRun()` into the existing Run flow — call it
inside `runProject()` right after the iframe `src` is set (so a Run while
paused leaves the new run unpaused, which is the right default).

---

## Patch 3 — runtime/PROTOCOL.md addendum

**File:** `runtime/PROTOCOL.md`

Add a new section near the bottom, before the change log. The existing
"Runner → editor messages" section stays unchanged — pause is editor →
runner via Module exports, which is a different shape than postMessage and
deserves its own header.

```markdown
## Editor → runner direct calls (c7)

A second cross-frame channel exists alongside the postMessage channel
above: the editor calls into the runner's `Module` object directly via
`previewFrame.contentWindow.Module._magnetar_<name>()`. Same-origin
guarantees this is safe; no postMessage round-trip is needed for
synchronous engine-state queries.

**Currently defined exports (all `EMSCRIPTEN_KEEPALIVE` from
`magnetar_hooks.cpp`):**

| Export | Signature | Meaning |
|---|---|---|
| `_magnetar_get_fps` | `() -> int` | Current frame rate from the timer module. Returns -1 if timer isn't initialized yet. Polled at 2Hz from `runner.js`. |
| `_magnetar_pause` | `() -> void` | Pauses all currently-playing audio sources and remembers them. Idempotent: a second call before resume is a no-op. Editor calls this BEFORE `Module.pauseMainLoop()` so the hook runs while the loop is still alive. |
| `_magnetar_resume` | `() -> void` | Discards the wall-clock gap accumulated during pause (single `Timer::step()` discard) and resumes the audio sources captured by the previous `_magnetar_pause`. Editor calls this AFTER `Module.resumeMainLoop()` so the loop is ready to advance. |

**Pause/resume sequencing rules:**

The editor must call these in a specific order to avoid two failure modes:

1. **Pause:** `_magnetar_pause()` first, then `Module.pauseMainLoop()`.
   Reverse order means the loop stops before the hook runs, leaving
   audio playing through the pause.
2. **Resume:** `Module.resumeMainLoop()` first, then `_magnetar_resume()`.
   Reverse order means `Timer::step()` runs while the loop is still
   halted; the discard succeeds but is one frame imprecise.

Pause state is editor-side only. The runner has no `is_paused` query —
the editor is the source of truth. When the iframe reloads (fresh Run),
the new `Module` starts unpaused and the editor resets its local state
to match.

**Time-freeze semantics:**

When paused, the simulation behaves as if no real time has passed:

- `love.update(dt)` is not called (the main loop is halted).
- `love.draw()` is not called (same reason). The canvas retains its
  last frame.
- Audio sources that were playing are paused; they resume from the
  same playback offset on resume.
- `love.timer.step()` does not tick during pause. On resume, the
  accumulated wall-clock gap is discarded by a single `Timer::step()`
  call whose result we throw away. The next real `step()` inside
  `love.run` returns a small, normal dt.
- `love.timer.getTime()` is not observed because no game code is
  running. After resume, `getTime()` returns wall-clock-since-boot,
  which means a `getTime()` reading taken before pause and one after
  resume will differ by the pause duration. This is a known limitation
  for code that drives effects directly off `getTime()` (rare in
  practice — most LÖVE code uses dt accumulators).

**Tier-3 limitations (documented, not fixed):**

- `love.thread` threads, if used, would keep running through pause.
  Currently a non-issue because pthreads are not enabled in this build
  (megasource-web/CMakeLists.txt has no `-pthread` or `USE_PTHREADS`).
  If pthreads are enabled in a future build, this plan needs revision.
- Network sockets / coroutines on their own schedule (not driven by
  the main loop) would also keep running. Same status as threads: not
  applicable to the current LÖVE-on-WASM environment.
```

Add a change-log entry at the end:

```markdown
- **c7** — added `_magnetar_pause` and `_magnetar_resume` exports to
  `magnetar_hooks.cpp`. Editor pairs them with `Module.pauseMainLoop()`
  / `Module.resumeMainLoop()` for engine-level pause that preserves dt
  continuity on resume.
```

---

## Build steps

Same flow as c6, since the work is in the same `magnetar_hooks.cpp`:

```powershell
C:\Users\Trynda\Desktop\Dev\magnetar-build\build.ps1
```

Incremental rebuild — only `magnetar_hooks.cpp` changed, so this is a
relink-and-deploy, not a full 25-minute build. Expect single-digit
seconds. The build script copies `love.js` + `love.wasm` into
`magnetar-editor-v2\runtime\vendor\` automatically.

---

## Verification

In order, each step gates the next:

1. **Build success.** `strings runtime/vendor/love.wasm | grep magnetar`
   should now print `magnetar_get_fps`, `magnetar_pause`, and
   `magnetar_resume`. Three exports, not one. If only one shows, the
   patch didn't take — check `EMSCRIPTEN_KEEPALIVE` is on each new
   function and `<vector>` / `Audio.h` / `Source.h` are included.

2. **No regression.** Open Breakout. It runs as before. FPS counter
   updates. No errors in the console.

3. **Pause click suspends visible motion.** Open Breakout, click Pause.
   Ball stops mid-flight. FPS counter freezes (no new frames). Click
   again: ball continues from exactly where it paused, no teleport,
   FPS counter resumes ticking.

4. **Audio pauses with visuals.** Open a fixture with sound (or add a
   `love.audio.newSource` test fixture). Start playback. Click Pause:
   sound stops. Click again: sound resumes from the same offset.

5. **dt continuity.** This is the headline check. Open a fixture with a
   physics body in motion (or just a position-update-by-dt). Pause for
   ~10 seconds. Resume. The body should continue at its original
   velocity from where it paused, NOT teleport ahead by ~10 seconds of
   simulated motion. If it teleports, the `Timer::step()` discard
   isn't firing — check `_magnetar_resume` includes the timer call.

6. **Pre-boot click is safe.** Open the editor. Before clicking Run,
   click Pause. Nothing should crash. The button should toggle
   aria-pressed visually but no engine call should fire (because
   `Module._magnetar_pause` doesn't exist yet). After Run, the next
   Pause click should work normally.

7. **Run-while-paused resets state.** Pause a running game. Click Run.
   The new game should start unpaused (button aria-pressed=false) and
   advance normally. If the new game starts paused, the
   `resetPauseStateForFreshRun()` hook isn't being called — verify
   it's wired into the existing `runProject()` flow.

---

## Failure modes and triage

If something breaks during verification, locate it on this list before
going deep:

- **`Module._magnetar_pause is not a function`** in console → the
  export didn't survive linking. Almost always means
  `EMSCRIPTEN_KEEPALIVE` is missing from the function definition.
  Check `magnetar_hooks.cpp` and rebuild.
- **Pause clicked but audio keeps playing** → `Audio::pause()`
  returned an empty vector (no sources were playing) OR audio is
  flowing through a path that `Audio::pause()` doesn't reach.
  Verify with `console.log(previewFrame.contentWindow.Module
  ._magnetar_pause)` that the export exists, then check the audio
  fixture is actually triggering `Source:play()` and not some lower-
  level path. If sources are playing but pause doesn't stop them, fall
  back to also calling `Audio::pauseContext()` and SDL3 context
  suspend — but this should not be needed in v1.
- **dt teleport on resume** (body skips ahead) → the `Timer::step()`
  discard didn't fire. Verify `_magnetar_resume` is being called BEFORE
  the loop ticks — i.e. AFTER `resumeMainLoop()` but in the same JS
  task, not deferred. The current patch does this synchronously.
- **Pause clicked but loop keeps running** (FPS counter still ticks)
  → `Module.pauseMainLoop` isn't exposed in this love.js build. Check
  `grep pauseMainLoop runtime/vendor/love.js` — should match. If not,
  the build flags differ from the verified version; check
  `MainLoop.pause` is exported. (As of the verified build, it is.)
- **Audio resumes at wrong offset on un-pause** → `Audio::play(vector)`
  is internally calling `Source::play()` which from a paused state
  resumes — but if a source was internally stopped (not paused) it
  would restart from offset 0. Check the source is actually in
  `STATE_PLAYING` before pause. This shouldn't happen in normal
  fixture playback but is worth flagging.

---

## Open questions deferred

- **Pause + Run interaction.** Currently a Run while paused starts the
  new run unpaused. Alternative: preserve the pause state across Run.
  Considered and rejected for v1: a fresh Run is conceptually a new
  session, and starting it paused-by-default is surprising. Easy to
  revisit.
- **Pause keybinding.** No shortcut yet. Spacebar is the natural
  choice but conflicts with games that use space for input. Could
  default to Esc or a modified key (Ctrl+P). Defer until the keybind
  dispatcher work lands.
- **Pause indicator on the canvas itself.** Currently only the button
  reflects state. A subtle "PAUSED" overlay on the preview would help
  in fullscreen mode where the strip isn't visible. Visual design
  question, not engine. Defer.
- **Audio context suspend as belt-and-suspenders.** If `Audio::pause()`
  ever turns out to miss SDL3-routed audio in some edge case, we'd
  add a JS-side `previewFrame.contentWindow.SDL3?.audioContext?.suspend()`
  call alongside. Not adding speculatively in v1 because the source-
  level pause should cover it.
