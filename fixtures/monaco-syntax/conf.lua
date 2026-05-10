-- conf.lua for the monaco-syntax fixture.
-- This fixture exists to inspect Monaco's rendering of the
-- magnetar theme; it also runs as a tiny Love2D scene so you
-- can sanity-check the editor is still wired up end-to-end.
function love.conf(t)
  t.window.width = 800
  t.window.height = 480
  t.window.title = "Magnetar — monaco syntax fixture"
end
