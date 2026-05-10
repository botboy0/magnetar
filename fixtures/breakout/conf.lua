-- Breakout config.
-- Love2D reads this before main.lua and uses it to set up the
-- window. The 800×600 4:3 canvas is what the brick layout, paddle,
-- and ball physics in main.lua assume — change with care.
function love.conf(t)
    t.window.width = 800
    t.window.height = 600
    t.window.title = "Breakout"
end
