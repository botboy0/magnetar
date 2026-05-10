# Breakout

LOVE2D game running in-browser via [love.js](https://github.com/pfirsich/lovejs-api).

## Source and build artifacts

- `game.love` — the authoritative LOVE archive (a zip containing `main.lua`)
- `game.data` — Emscripten asset package wrapping `game.love`
- `game.js` — Emscripten-generated loader (pairs with `../../runtime/love.js`)
- `src/main.lua` — reference copy of the Lua source extracted from `game.love`, kept for readability. If you update the game, rebuild `game.love` first, then sync this copy.
