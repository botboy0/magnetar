# Top-strip Drift Repair — Travel Plan

A precise, low-scope plan for restoring the top strip from the `magnetar_editor_final_mockup.html` reference. Three drifts in HTML markup, six in CSS, plus one structural choice the implementation made by accident that needs to become a deliberate decision.

Total surface: **one HTML file, one CSS file, ~30 lines of changes**. No JS, no architecture, no visual rework — just restoring agreed-on intent.

---

## What drifted, in priority order

The five visible problems from the screenshot, mapped to root causes:

| Symptom | Root cause |
|---|---|
| Title is rendering as just `"a"` | Markup is missing `.project-title-group` wrapper; the title's overflow rules are colliding with the project-bar's flex sizing, clipping the text. |
| Navigator tile dominates the bar | The bar is using `align-items: flex-start` instead of `align-items: center` on its primary state. Tile + content disagree on baseline. |
| Title looks small / quiet | `font-size: 1.05rem` and `letter-spacing: -0.01em` were tightened from the mockup's `1.1rem` and `-0.005em`. Within the bar's height the smaller value reads as muted. |
| No middot between title-cluster and caption | The `::before { content: "·" }` rule on `.project-caption` is missing in the implementation CSS. |
| Caption "MAGNETAR" rendering as a boxed label | Markup uses `<span class="by">` with no defined CSS — falls through to default styling. The mockup uses `<span class="by-author">` and the rule defines it cleanly. |

The truncation bug is the worst of these because it hides the title entirely. Fix it first; the rest become easier to evaluate against a real title.

---

## Phase A — HTML markup (one file, ~5 lines)

Open `editor.html` lines 42–49. The current state:

```html
<div class="project-bar">
  <span class="project-title">untitled</span>
  <svg class="project-pen" ...>...</svg>
  <span class="project-caption">A <span class="by">MAGNETAR</span> PROJECT BY trynda</span>
</div>
```

The mockup wraps title + pen in a `.project-title-group` and uses `by-author` (not `by`) for the inline highlight. Restore that:

```html
<div class="project-bar">
  <div class="project-title-group" title="Click to rename">
    <span class="project-title">untitled</span>
    <svg class="project-edit" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>
  </div>
  <div class="project-caption">
    A Magnetar project by <span class="by-author">trynda</span>
  </div>
</div>
```

Three things changed:

1. Title and pen now wrapped in `.project-title-group` — gives them their own layout context, so the title can shrink/ellipsize cleanly without dragging the caption around. This is the fix for the truncation bug.
2. `.project-pen` → `.project-edit` to match the mockup's CSS naming. (Optional — if it's less work to leave the class name as `project-pen` and rename the CSS rule instead, do that. Either way, names need to agree.)
3. The caption shape changed: rather than the entire caption being uppercase with `MAGNETAR` highlighted, only the *author* name gets the inline highlight. The caption text itself is normal-cased ("A Magnetar project by") and `text-transform: uppercase` from CSS handles the small-caps presentation. This is what makes the author name read as the *clickable* element rather than the word "MAGNETAR" looking like a button.

Update any JS that references `.by` to use `.by-author`. Search project-rename.js and any other component that touches caption rendering for `.by` and update.

---

## Phase B — CSS structure fixes (`top-strip.css`)

Six concrete changes. Listed in the order they affect the cascade.

### B1. The bar's vertical alignment is wrong

Current `top-strip.css` has both `align-items: flex-start` (line 11) which is the *flex-start* state for when the dropdown is open — and a single `align-self: center` override on `.project-bar` (lines 23–25) trying to compensate.

The mockup uses the same pattern. This is actually correct. So why does it look wrong?

Because in the mockup, the *visual* center of the bar comes from `min-height: 42px` + `padding: 6px 14px`. The Navigator tile is sized to fit this — it doesn't push the bar taller than 42px. Currently the Navigator's content (wordmark at 1.15rem, padding 5px top/bottom) is producing a tile bigger than the bar, and `flex-start` is pinning it to the top of an already-too-short bar.

Fix: keep the alignment rules as-is, but verify the navigator-trigger's measured height. Open dev tools, inspect `.navigator-trigger`, confirm `offsetHeight` ≤ 30px. If it's larger, the wordmark's font-size or the trigger's padding has drifted.

If everything's at spec values and the tile *still* looks too big, the issue is that `min-height: 42px` is too tight for a 1.15rem wordmark with 5px padding (1.15rem × 16px ≈ 18.4px line-height-1, plus 10px padding = 28.4px, leaves 13.6px of bar headroom split top/bottom). That's only 6.8px of breathing room, which reads as "tile fills the bar." The mockup's 42px works because Syne at this weight runs slightly tighter than a typical sans-serif. Worth raising `min-height` to 44px or 46px and seeing if the bar feels right — that's a one-pixel change that'd add visible breathing room.

### B2. `.project-title` typography

Three values drifted. Restore to mockup spec:

```css
.project-title {
  font-family: "Syne", sans-serif;
  font-weight: 700;
  font-size: 1.1rem;            /* was: 1.05rem */
  color: var(--stardust);
  letter-spacing: -0.005em;     /* was: -0.01em */
  line-height: 1.1;             /* was: missing */
  /* white-space: nowrap, overflow: hidden, text-overflow: ellipsis MOVE
     to .project-title-group instead — the title itself shouldn't carry
     overflow rules now that it's wrapped */
}
```

`line-height: 1.1` is doing real work here — it pulls the title's line-box tight to its ascender so the title sits at the optical center of the bar instead of riding low.

### B3. Add `.project-title-group` styling

The wrapper introduced in Phase A needs its own rule. Mockup spec:

```css
.project-title-group {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: text;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background 0.12s;
}
.project-title-group:hover {
  background: rgba(255,255,255,0.02);
}
```

The hover-background is a small detail but it's what makes "click to rename" feel like a real affordance — there's a subtle hit-target highlight that says "this is interactive."

### B4. Pen icon size and color

Currently `.project-pen` is 14px. Mockup is 13px and uses `.project-edit` as the class name. If you keep `project-pen` as the class name in HTML, just update the rule:

```css
.project-pen {
  width: 13px;
  height: 13px;
  stroke: var(--muted-2);
  stroke-width: 1.8;
  fill: none;
  transition: stroke 0.15s;
  cursor: pointer;
  flex-shrink: 0;             /* was: missing */
}
.project-pen:hover {
  stroke: var(--mag-cyan);
}
```

`flex-shrink: 0` is important — without it, the pen icon will shrink to nothing if the title gets long, before the title itself ellipsizes. That's the wrong precedence.

### B5. The middot separator

This is the thing that visually splits title from caption. Currently missing entirely. Add to `top-strip.css`:

```css
.project-caption {
  font-family: "Space Mono", monospace;
  font-size: 0.68rem;            /* was: 0.7rem */
  letter-spacing: 0.12em;        /* was: 0.1em */
  text-transform: uppercase;
  color: var(--muted-2);
  display: inline-flex;          /* was: missing — needed for ::before */
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}
.project-caption::before {
  content: "·";
  color: var(--muted);
  letter-spacing: 0;
}
.project-caption .by-author {
  color: var(--mag-cyan);
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
}
.project-caption .by-author:hover {
  text-decoration: underline;
}
```

The middot is a `::before` pseudo-element rather than a literal character in the markup — that way it can't be selected as text, can't be edited away, and stays visually consistent with how separators are handled elsewhere (e.g. the status-line uses `.meta-sep` with `·` content).

`.by-author` (replacing `.by`) gets the cyan highlight + underline-on-hover. This is the change that makes the author name look like the interactive element instead of the word "MAGNETAR."

### B6. The bar's `align-items` declaration

Currently in `top-strip.css` line 11–17 there's a redundancy:

```css
.topstrip {
  align-items: flex-start;     /* line 11 */
  ...
  align-items: flex-start;     /* line 17 */
}
```

The mockup has the same redundancy intentionally (the comment explains it: `align-items: center` is the natural default; `flex-start` is overriding for the dropdown-open case). But the duplicate `flex-start` lines mean the comment-driven intent is lost. Recommended cleanup:

```css
.topstrip {
  display: flex;
  /* When the Navigator dropdown is open it grows in-flow; flex-start
     prevents that growth from stretching the bar itself. The strip
     stays at chrome height; the dropdown overflows downward. */
  align-items: flex-start;
  overflow: visible;
  /* ...rest of properties... */
}

/* Override per-child to restore vertical centering for siblings
   that don't need to overflow (project bar). */
.topstrip .project-bar { align-self: center; }
.topstrip .navigator   { align-self: flex-start; }
```

Same effect, but the intent reads clearly.

---

## Phase C — Verification

After the changes, three visual checks:

**Title is readable.** Open the editor with `untitled` as the title. Should see "untitled" not "a." Try renaming to "the-quick-brown-fox-jumps-over-the-lazy-dog" — should ellipsize cleanly *within the title group*, with the pen icon still visible to its right, the middot still rendering, and the caption still readable.

**Navigator and title agree on a baseline.** The plasma chevron's vertical center should match the title's optical center. Eyeball it; if one looks higher than the other, `line-height: 1.1` on the title isn't doing its job, or the navigator-trigger's padding is wrong.

**Caption reads correctly.** Should see `· A MAGNETAR PROJECT BY trynda`, with `trynda` in cyan and underlining on hover. The word "MAGNETAR" should be plain uppercase text, not a boxed label.

---

## What this plan deliberately does NOT do

- **No structural changes to the bar.** The Navigator + title-group + caption layout is correct. Only its implementation details drifted.
- **No new components.** Everything described already exists in the mockup; the work is restoration, not invention.
- **No JS changes beyond a class-name find-replace** (`.by` → `.by-author`, possibly `.project-pen` → `.project-edit` if you take that rename).
- **No mockup-file updates.** The mockup is the reference; the implementation moves toward it, not the other way around.
- **No decision about caption-on-public-pages.** Earlier conversation discussed whether the caption belongs in editor mode at all. With the mockup as your ground truth, the answer is yes-it-belongs. Park the question.

---

## Estimated time

For someone with your CSS background: 30–60 minutes including the visual-verification step and the JS class-name updates. The risk axis is "did I miss any place that references `.by` or `.project-pen`" — single grep across the repo before committing eliminates that.

If the bar still feels off after these changes, the next thing to investigate isn't more drift — it's whether `min-height: 42px` is genuinely tight enough for Syne 1.15rem to breathe. Bumping to 46px and lowering the tile's padding by 1px is a one-character experiment that's worth trying if the visual doesn't click.

---

## End-of-pass check

If at the end of this you can rename a project to a long string, see the title ellipsize cleanly within its group while the caption stays put and the middot anchors them, the drift repair is done. PROJECT.md doesn't need an edit — this is implementation matching its existing reference, not a design change.
