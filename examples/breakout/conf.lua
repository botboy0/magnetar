-- Breakout config.
-- Love2D reads this before main.lua and uses it to set up the
-- window. 1280×720 (16:9) matches Magnetar's preview stage so the
-- game fills the frame without letterboxing. main.lua's W/H
-- constants must match these dimensions.
function love.conf(t)
    t.window.width = 1280
    t.window.height = 720
    t.window.title = "Breakout"
end
