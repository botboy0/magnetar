/* ============================================================
   main-editor.js
   Orchestrator for editor.html.
   In commit 2 this only initializes the shared top strip.
   Commit 4 adds project storage (localStorage) + pen rename.
   Commit 5 adds Run button wiring + status badge handling.
   ============================================================ */

import { init as initTopStrip } from './components/top-strip.js';

initTopStrip();