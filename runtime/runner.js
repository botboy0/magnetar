/* ============================================================
   runner.js
   Magnetar runtime harness.

   Reads a payload from sessionStorage, validates it against the
   protocol (see PROTOCOL.md), injects each file into the
   Emscripten virtual filesystem in `preRun`, and boots Love.js.

   This file OWNS the contract with the editor. Any change to
   the payload shape must be reflected here AND in PROTOCOL.md,
   and bumped via `version` — don't silently extend.

   Scope boundary:
   - Owns sessionStorage read, payload validation, FS injection,
     and Module/Love.js boot.
   - Knows nothing about Monaco, projects, localStorage, or any
     editor-side concern. The payload is the only thing crossing
     the boundary.
   ============================================================ */

(function () {
  'use strict';

  const PAYLOAD_KEY = 'magnetar.runtime.payload';
  const SUPPORTED_VERSION = 1;

  /* ---------- 1. Read + validate payload ----------
     Any failure path renders a message into #message and
     returns without kicking Love.js. A broken payload should
     never crash — the runner is often opened in an iframe
     that the user can't directly see a console for. */

  const payload = readPayload();
  if (!payload) return; /* message already rendered */

  /* ---------- 2. Configure Emscripten Module ----------
     preRun runs after the FS is initialized but before main().
     That's where we materialize the user's files into the
     virtual filesystem. Love.js then boots normally and finds
     main.lua at `/`.

     arguments: ['/'] tells Love2D to run the project rooted at /.
     Same as v1's test_a/game.js; the engine expects this. */

  window.Module = {
    arguments: ['/'],
    canvas: document.getElementById('canvas'),
    printErr: console.error.bind(console),

    preRun: [function () {
      try {
        for (const [name, code] of Object.entries(payload.files)) {
          /* FS_createDataFile(parent, name, data, canRead, canWrite, canOwn).
             canOwn=true lets Emscripten keep the string as-is
             instead of copying; fine because we don't mutate
             payload.files after this point. */
          Module.FS_createDataFile('/', name, code, true, true, true);
        }
      } catch (e) {
        console.error('[runtime] FS injection failed:', e);
        fail('Failed to load project files — see console.');
      }
    }],

    setFocus: typeof setFocus === 'function' ? setFocus : undefined,

    setStatus: function (text, soFar, total) {
      drawLoadingStatus(text, soFar, total);
    },

    onRuntimeInitialized: function () {
      /* The engine is up — hide the loading overlay so the
         canvas underneath is unobstructed. Love.js doesn't
         reliably emit a final empty setStatus("") we could
         hook off, so we hide here instead.
         (Earlier draft hid in setStatus when text==="" and
         remainingDependencies===0; that branch was unreachable
         in practice because the last setStatus call carries
         "All downloads complete." text, not empty string.) */
      const overlay = document.getElementById('message-container');
      if (overlay) overlay.style.display = 'none';

      /* Tell the editor the engine is up. The editor's preview-strip
         flips its `t` metric to running optimistically when Run is
         clicked; this message confirms the boot completed (vs. the
         editor showing the timer against a still-loading engine).

         See PROTOCOL.md "Runner → editor messages" / magnetar.status. */
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'magnetar.status',
          state: 'running',
        }, '*');
      }

      /* Canvas dimensions need a separate reporting path. At this
         moment (onRuntimeInitialized = Emscripten runtime ready),
         Love2D hasn't actually run yet — main.lua hasn't been
         executed, conf.lua hasn't been processed, love.window.setMode
         hasn't been called. The canvas is still at the HTML default
         (800×600 from runner.html's <canvas> attributes). Reading
         dims here would lie.

         ResizeObserver fires when canvas intrinsic dims change, which
         happens when Love2D applies setMode during boot. First fire
         = real dimensions. Subsequent fires = mid-run resize calls,
         which we forward too so the editor stays accurate.

         Note: ResizeObserver tracks border-box (CSS) by default, but
         we want intrinsic. We read .width/.height directly inside
         the callback rather than from the observer entry, since
         intrinsic pixel dims aren't what ResizeObserver natively
         reports — they're what we care about. The observer just
         tells us "something changed; re-read." */
      const canvasEl = document.getElementById('canvas');
      if (canvasEl && window.parent && window.parent !== window) {
        let lastW = 0, lastH = 0;
        const reportCanvas = () => {
          const w = canvasEl.width | 0;
          const h = canvasEl.height | 0;
          if (w === lastW && h === lastH) return;
          lastW = w;
          lastH = h;
          window.parent.postMessage({
            type: 'magnetar.status',
            canvas: { width: w, height: h },
          }, '*');
        };
        /* ResizeObserver only fires on CSS-size changes, not intrinsic
           dim changes. So we also poll briefly during early boot to
           catch the conf.lua-driven resize, then stop. setInterval
           guards against the case where Love sets dims to the same
           CSS size (so ResizeObserver never fires) but different
           intrinsic resolution. */
        const pollInterval = setInterval(reportCanvas, 100);
        setTimeout(() => clearInterval(pollInterval), 3000);
        if (typeof ResizeObserver !== 'undefined') {
          new ResizeObserver(reportCanvas).observe(canvasEl);
        }
      }

      /* Focus-change hooks so Love.js knows when the game has
         window focus (useful for pausing input). Copied from
         v1's scaffold. */
      window.addEventListener('focus', function () {
        if (typeof Module['_love_setFocus'] === 'function') {
          Module._love_setFocus(true);
        }
      });
      window.addEventListener('blur', function () {
        if (typeof Module['_love_setFocus'] === 'function') {
          Module._love_setFocus(false);
        }
      });
    },

    setExceptionMessage: typeof onException === 'function' ? onException : undefined,

    totalDependencies: 0,
    remainingDependencies: 0,
    monitorRunDependencies: function (left) {
      this.remainingDependencies = left;
      this.totalDependencies = Math.max(this.totalDependencies, left);
      Module.setStatus(
        left
          ? 'Preparing... (' + (this.totalDependencies - left) + '/' + this.totalDependencies + ')'
          : 'All downloads complete.'
      );
    },
  };

  Module.setStatus('Downloading...');

  /* ---------- 3. Kick off Love.js ----------
     Load the vendored engine bundle. The runner.html inline
     script has already defined Module's status/error helpers,
     so by the time love.js calls Love(Module), everything is
     wired. */

  const s = document.createElement('script');
  s.src = 'vendor/love.js';
  s.onload = function () {
    if (typeof Love !== 'function') {
      console.error('[runtime] vendor/love.js loaded but Love() is not defined');
      drawMessage('Runtime failed to initialize.');
      return;
    }
    Love(Module);
  };
  s.onerror = function () {
    console.error('[runtime] failed to load vendor/love.js');
    drawMessage('Runtime failed to load.');
  };
  document.body.appendChild(s);


  /* ============================================================
     Payload validation.
     ============================================================ */

  function readPayload() {
    const raw = sessionStorage.getItem(PAYLOAD_KEY);

    if (!raw) {
      fail('No project loaded.');
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('[runtime] payload is not valid JSON:', e);
      fail('Payload is corrupt.');
      return null;
    }

    if (!parsed || typeof parsed !== 'object') {
      fail('Payload is malformed.');
      return null;
    }

    if (parsed.version !== SUPPORTED_VERSION) {
      console.error(`[runtime] unsupported payload version: ${parsed.version} (expected ${SUPPORTED_VERSION})`);
      fail(`Unsupported payload version: ${parsed.version}`);
      return null;
    }

    if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
      fail('Payload is missing files.');
      return null;
    }

    if (typeof parsed.entry !== 'string' || !parsed.entry) {
      fail('Payload is missing entry.');
      return null;
    }

    if (!(parsed.entry in parsed.files)) {
      fail(`Entry file not found: ${parsed.entry}`);
      return null;
    }

    /* Love2D always runs main.lua regardless of what `entry`
       says. The field is reserved for future configurable-entry
       support; for now, warn and carry on if it's something
       else. This keeps the protocol honest: we declare what
       we'll do with the field, and we only ignore it loudly. */
    if (parsed.entry !== 'main.lua') {
      console.warn(
        `[runtime] entry is "${parsed.entry}" but Love2D will run main.lua. ` +
        `Configurable entry is not yet implemented.`
      );
    }

    return parsed;
  }

  /* Render a message into the runner's overlay AND forward to the
     editor as a magnetar.error. Used for any runner-side failure
     the user should see in the editor's status-line. (Runtime
     exceptions go through onException in runner.html, which has
     its own forwarding.) */
  function fail(message) {
    drawMessage(message);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'magnetar.error',
        message: message,
      }, '*');
    }
  }
})();
