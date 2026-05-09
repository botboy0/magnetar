# Magnetar

> **This document is frozen.**
> It captures what Magnetar aims to be and how it's being built. It does not track current implementation state — that lives in the codebase and in whatever working notes the current workflow uses. Update this file only if Magnetar's aims or approach change.

---

## What Magnetar is

Magnetar is a free, open-source, MIT-licensed, modular game-creation ecosystem.

The public-facing core is a browser-based editor: anyone with a browser can open it, make a game, and share it without installing anything. Behind the editor sits a runtime — an ECS and utility layer on top of LÖVE2D — that the editor compiles to and that runs the game both inside the editor's preview and as standalone exports. An Electron desktop app and community / social features are planned but not actively built; when they ship, they extend the ecosystem rather than replace any part of it.

The destination is a tool that a curious teenager can open in a browser tab and start making something with in the first five minutes, that a professional can grow into without hitting a ceiling, and that no one ever has to pay for, ask permission to use, or worry about being locked out of.

## What Magnetar is not

It is not a hobby project that might one day become commercial. It is not a freemium product with a paid tier waiting in the wings. It is not a closed ecosystem with an open-source veneer. It is not a kitchen-sink IDE that asks beginners to navigate twenty panels before they can draw a rectangle. The four values below rule those shapes out by construction.

---

## The four values

These are non-negotiable. Every decision — feature, dependency, partnership, repo layout, license choice — gets evaluated against them. If a decision violates one, the decision is wrong, not the value.

### Always free

There is no paid tier. There is no "pro" version. There are no features gated behind a subscription, an account, or a payment. The full editor, runtime, and toolchain are free at the point of use, forever. This rules out any architecture that depends on closed infrastructure to function — Magnetar must remain runnable by anyone, with no Magnetar-the-organization in the loop.

### Always open-source

The source for everything Magnetar ships is public and modifiable. Forks are welcome. Anyone can read why something works the way it does, change it, and run their changed version. This rules out closed components, proprietary plugins as a first-party offering, and any "core is open, the good stuff is closed" gradient.

### MIT licensed

Permissive. Anyone can take Magnetar, including parts of it, and use it in their own projects — commercial, non-commercial, derivative, embedded — without a viral license obligation. This is a deliberate choice over copyleft: the goal is maximum reach, including into contexts where copyleft would be a non-starter. People building things with Magnetar should not have to think about the license.

### 100% modular

Every component stands alone. The editor doesn't require the community features to work. The runtime doesn't require the editor. The desktop app, when it lands, doesn't require any specific server. Plugins extend; they don't entangle. This rules out tightly-coupled features and any architecture where pulling one piece out breaks the rest. Modularity is also what makes "always free" and "always open-source" durable — a tightly-coupled system has chokepoints that future pressure can squeeze; a modular one doesn't.

---

## How we're getting there

### Beginner-friendliness is a product principle, not a nice-to-have

Magnetar is an explicit reaction to the panel-firehose problem in tools like Unity and Blender — interfaces that present every capability at once and ask first-time users to navigate complexity before they've made anything. Magnetar's interface earns complexity: first-run users see a small, recognizable surface; advanced capability is opted into, not imposed. Every piece of chrome must justify its slot. Aspirational UI — buttons that look real but don't do anything yet, panels that hint at unbuilt features — is cut, not shipped as a teaser.

This is not a UX preference. It's a product principle, because the alternative (panel firehose) is what excludes the audience Magnetar is for: people who don't already know game engines.

### The editor is the public-facing core

Most users will only ever meet Magnetar through the editor in their browser. That makes the editor the primary surface for every value above. "Always free" means the editor is reachable without an account. "Always open-source" means the editor's source is public. "100% modular" means the editor is a client of the runtime, not a monolith that bundles it. "Beginner-friendly" is the editor's first impression: open it, see something familiar, make something.

Because the editor is the public face, decisions about it are made carefully and rejections are recorded. New ideas are weighed against what's already been considered and discarded.

### The runtime is a fork of rozenmad's love-web

The browser-based runtime layer is built on a Magnetar-maintained fork of `rozenmad/love-web` (LÖVE 12 + SDL3, compiled to WebAssembly). The fork is read-only: it adds outbound observation hooks that the editor needs (engine telemetry, structured error reporting), but never modifies how user code runs. A game running on the Magnetar fork produces the same result as on vanilla rozenmad. Implementation details live in `runtime/PROTOCOL.md`.

### Modularity is enforced at the boundaries

The editor talks to the runtime through a single documented protocol (`runtime/PROTOCOL.md`). The runtime talks to the engine through Module / postMessage. Each boundary is narrow on purpose: it's what lets each layer evolve, fork, or be replaced without dragging the others. When in doubt, narrow the boundary further.

---

## What this means for contributors

- If a proposed feature would require closed infrastructure, a paid tier, an account, or Magnetar-the-organization being in the runtime loop, it doesn't fit. Find a different shape for it.
- If a proposed feature would tightly couple two layers — for example, baking editor knowledge into the runtime, or making the desktop app depend on a Magnetar-hosted service — it doesn't fit. Narrow the boundary instead.
- If a proposed UI element doesn't yet have an honest implementation behind it, don't ship it. Aspirational chrome erodes the trust that makes a beginner-friendly tool actually beginner-friendly.
- If a proposed change touches what beginners see first, the bar is higher: complexity gets opted into, not added by default.

These aren't rules invented for the document. They're consequences of the four values, written down so the consequences don't get re-derived (and re-litigated) every session.
