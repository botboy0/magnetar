# Magnetar Runtime Protocol

Contract between the editor and the runtime. Kept honest: what's here is what the code does.

---

## Overview

The editor writes a **payload** to `sessionStorage` and loads (or reloads) `runtime/runner.html` in an iframe. The runner reads the payload, injects each file into Love.js's virtual filesystem, and boots the engine.

That's it. One key, one JSON value, one read per boot.

---

## The payload

**Storage key:** `magnetar.runtime.payload`
**Value:** JSON string.

**Shape (v1):**

```json
{
  "version": 1,
  "files": {
    "main.lua": "function love.load() ... end",
    "utils.lua": "local M = {} ... return M"
  },
  "entry": "main.lua"
}
```

### Field rules

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | integer | yes | Must equal the runner's `SUPPORTED_VERSION` (currently `1`). Mismatch → runner refuses to boot. |
| `files` | `{[filename]: code}` | yes | String-to-string map. Keys are filenames, values are file contents. Empty object is invalid (no `entry` could resolve). |
| `entry` | string | yes | Must be a key in `files`. Reserved for future configurable-entry; today Love2D always runs `main.lua`. If `entry !== "main.lua"`, runner logs a warning and still boots `main.lua`. |

### What's NOT in v1

Fields deliberately omitted to keep the surface small:

- **No `projectId`.** The runtime doesn't need to know which project it's running; it just runs code. If future runtime-state-per-project features land, bump to `version: 2`.
- **No `ts` / timestamp.** Cache-busting is the editor's job (`iframe.src = 'runtime/runner.html?t=' + Date.now()`), not the payload's.
- **No runtime flags** (debug mode, headless, etc.). Add with a version bump when a real use case appears.
- **No canvas dimensions.** Canvas size is a Love2D-level concern, configured by the project via `conf.lua` (Love2D's standard config mechanism — see https://love2d.org/wiki/Config_Files). The runner does not inject defaults: if a project ships no `conf.lua`, Love2D falls back to its own defaults (800×600). The starter fixture ships a 1280×720 (16:9) `conf.lua` so new projects default to a modern aspect ratio. The editor's preview frame fills its container; the canvas inside scales to fit while preserving the framebuffer's intrinsic aspect, letterboxing any slack.

---

## Versioning rules

- `version` is an integer.
- The runner checks `payload.version === SUPPORTED_VERSION` and refuses to boot on mismatch. No best-effort parsing of unknown versions.
- Adding optional fields to an existing version is **not** allowed — it breaks the "what the runner sees is what the editor sent" contract. Any shape change bumps the version.
- When bumping: the runner can choose to support multiple versions simultaneously, or drop old ones. Today's runner supports v1 only.

---

## Error handling (runner side)

The runner never crashes on a bad payload. All of these render a message into the runner's `#message` element and stop:

| Condition | Message |
|---|---|
| No payload in sessionStorage | `No project loaded.` |
| Payload isn't valid JSON | `Payload is corrupt.` |
| Payload isn't an object | `Payload is malformed.` |
| `version` mismatch | `Unsupported payload version: N` |
| `files` missing or wrong type | `Payload is missing files.` |
| `entry` missing or empty | `Payload is missing entry.` |
| `entry` not in `files` | `Entry file not found: <name>` |

Runtime errors (thrown by Love.js during execution) are handled separately via the inline `onException` handler in `runner.html` — they clear the canvas and surface via `window.onerror`.

---

## Writing a payload (editor side)

Editor code responsible for a Run click does, roughly:

```js
const payload = {
  version: 1,
  files: readAllModels(),   // { filename: code } from the runtime model registry
  entry: 'main.lua',
};
sessionStorage.setItem('magnetar.runtime.payload', JSON.stringify(payload));
iframe.src = 'runtime/runner.html?t=' + Date.now();
```

**Why read from Monaco models, not `project.files`:** models are the runtime source of truth. Autosave is debounced 300ms, so `project.files` can be briefly stale after a fast-click Run. Models are current on every keystroke.

(c5a ships the runner side only. The editor side lands in c5b.)

---

## Runner → editor messages

A second, narrow channel exists for the runner to send signals back up to the editor. Used today only for forwarding modified keystrokes (see below); intended substrate for future cross-frame keybind work and runtime-state surfacing (e.g. error reporting in c5c).

**Mechanism:** `window.parent.postMessage(message, '*')` from inside the iframe. The editor listens on its `window` and filters by `event.source === iframe.contentWindow`. Same-origin guarantees source identity is sufficient — origin checks are not needed.

**Message shape:** plain object with a `type` field. Unknown types are ignored (forward-compat).

**Currently defined types:**

| Type | Payload | Meaning |
|---|---|---|
| `magnetar.run` | none | User pressed Ctrl/Cmd+Enter while focused inside the iframe. Editor should run the project. |

**Reserved for future use** (do not implement these without a deliberate design pass):

- `magnetar.error` — runtime error surfacing (c5c).
- `magnetar.status` — runtime lifecycle state (booting/ready/errored, c5c).

### Modifier-key forwarding policy

The runner's keydown listener forwards modifier-keystrokes (Ctrl/Cmd/Alt + key) up to the editor and lets unmodified keystrokes flow to Love2D as game input. This is the dividing line between "editor controls" and "project input."

Today only Ctrl+Enter is forwarded with a specific message type. When a global-keybinds system lands, this listener is the substrate it'll extend — likely by forwarding all modified keystrokes and letting the editor's keybind dispatcher decide what they mean. The current narrow forward avoids speculative scope.

**Conflicts with Love2D shortcuts:** Ctrl+Enter is Love2D's default fullscreen toggle. Magnetar overrides it: "run" beats "fullscreen." Users wanting fullscreen use the preview-strip's fullscreen button.

---

## Directory layout

```
runtime/
  vendor/
    love.js            (Rozenmad's Love.js 12 build — do not modify)
    love.wasm          (Rozenmad's Love.js 12 WASM — do not modify)
  runner.html          (Magnetar-owned — loads vendor + runner.js)
  runner.js            (Magnetar-owned — payload reader, Module config, boot)
  PROTOCOL.md          (this file)
```

The `vendor/` subfolder is the ownership boundary. Anything inside is third-party and doesn't get edited; anything outside is ours and follows the project's conventions.

---

## Change log

- **v1 (c5a)** — initial protocol. `version` + `files` + `entry`. One-shot boot via iframe reload; no hot-reload, no runtime state queries.
- **c5b3** — added the runner → editor postMessage channel. First message type: `magnetar.run` (Ctrl+Enter inside the iframe). Payload protocol shape is unchanged — this is a separate channel, not a payload version bump.
