-- Magnetar starter config.
-- Love2D reads this before main.lua and uses it to set up the
-- window. Projects can edit these values to choose any canvas
-- size — Magnetar's runner respects whatever Love2D ends up with.
--
-- See https://love2d.org/wiki/Config_Files for the full set of
-- options (modules to disable, vsync, msaa, etc.).
function love.conf(t)
    t.window.width = 1280
    t.window.height = 720
    t.window.title = "Magnetar"
end
