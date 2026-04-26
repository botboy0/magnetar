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
