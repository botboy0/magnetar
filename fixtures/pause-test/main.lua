-- Magnetar — pause/resume verification fixture (manual)
--
-- Load via the editor console:
--   await magnetar.loadFixture('pause-test')
--
-- Then click Pause in the preview strip and watch each panel.
-- This fixture is a spec of the c7 pause contract, expressed as
-- something you can see and hear:
--
--   1. Ball motion: pause should freeze the ball mid-flight, resume
--      should continue from the same spot at the same velocity (no
--      teleport). dt-continuity check.
--
--   2. Audio: a 440Hz sine tone loops while running. Pause should
--      cut the sound; resume should bring it back at the same
--      volume from the same playback offset.
--
--   3. Two clocks: one accumulates dt (sim clock), one reads
--      love.timer.getTime() (wall clock). Pause should freeze
--      the sim clock; the wall clock will drift forward by the
--      pause duration. The drift counter shows their difference.
--      This is the documented limitation in PROTOCOL.md — code
--      that drives effects directly off getTime() will see the
--      gap; code using dt accumulators won't.
--
--   4. Multithread row: stays "n/a" — pthreads aren't enabled in
--      this Love.js build, so love.thread can't be exercised. The
--      row is here as a contract reminder; if the build flips on
--      USE_PTHREADS, this fixture needs a real thread test.

local ball = { x = 100, y = 360, vx = 280, vy = 180, r = 22 }

local simClock = 0       -- ticks via love.update(dt) — frozen during pause
local wallClockStart = 0 -- love.timer.getTime() at boot — keeps advancing in real time
local source            -- looping 440Hz tone
local audioFailed = false

local function makeTone(freq, seconds, volume)
    local rate = 44100
    local count = math.floor(rate * seconds)
    local sd = love.sound.newSoundData(count, rate, 16, 1)
    local twoPi = math.pi * 2
    for i = 0, count - 1 do
        sd:setSample(i, math.sin(twoPi * freq * i / rate) * volume)
    end
    return love.audio.newSource(sd)
end

function love.load()
    love.graphics.setBackgroundColor(0.04, 0.04, 0.06)
    wallClockStart = love.timer.getTime()

    local ok, err = pcall(function()
        source = makeTone(440, 1.0, 0.18)
        source:setLooping(true)
        source:play()
    end)
    if not ok then
        audioFailed = true
        print("[pause-test] audio init failed: " .. tostring(err))
    end
end

function love.update(dt)
    simClock = simClock + dt

    local w, h = love.graphics.getDimensions()
    ball.x = ball.x + ball.vx * dt
    ball.y = ball.y + ball.vy * dt
    if ball.x < ball.r then ball.x, ball.vx = ball.r, -ball.vx end
    if ball.x > w - ball.r then ball.x, ball.vx = w - ball.r, -ball.vx end
    if ball.y < ball.r then ball.y, ball.vy = ball.r, -ball.vy end
    if ball.y > h - ball.r then ball.y, ball.vy = h - ball.r, -ball.vy end
end

local function panel(x, y, w, h, label)
    love.graphics.setColor(0.10, 0.10, 0.14, 0.92)
    love.graphics.rectangle("fill", x, y, w, h, 8, 8)
    love.graphics.setColor(0.82, 0.84, 0.86, 0.9)
    love.graphics.print(label, x + 12, y + 8)
end

local function status(x, y, label, value, ok)
    love.graphics.setColor(0.55, 0.57, 0.62, 0.9)
    love.graphics.print(label, x, y)
    if ok == nil then
        love.graphics.setColor(0.82, 0.84, 0.86, 0.95)
    elseif ok then
        love.graphics.setColor(0.42, 0.82, 0.55, 0.95)
    else
        love.graphics.setColor(0.94, 0.55, 0.32, 0.95)
    end
    love.graphics.print(value, x + 170, y)
end

function love.draw()
    -- ball
    love.graphics.setColor(0.49, 0.23, 0.93, 0.25)
    love.graphics.circle("fill", ball.x, ball.y, ball.r * 1.8)
    love.graphics.setColor(0.49, 0.23, 0.93, 1.0)
    love.graphics.circle("fill", ball.x, ball.y, ball.r)
    love.graphics.setColor(1, 1, 1, 0.4)
    love.graphics.circle("fill", ball.x - ball.r * 0.3, ball.y - ball.r * 0.3, ball.r * 0.25)

    -- HUD panel
    local px, py, pw, ph = 16, 16, 420, 220
    panel(px, py, pw, ph, "pause-test — c7 contract")

    local wall = love.timer.getTime() - wallClockStart
    local drift = wall - simClock
    local sourceState = "—"
    if audioFailed then
        sourceState = "init failed"
    elseif source then
        if source:isPlaying() then sourceState = "playing"
        else sourceState = "paused" end
    end

    local row = py + 40
    status(px + 14, row,      "sim clock (dt sum)",  string.format("%.2fs", simClock))
    status(px + 14, row + 22, "wall clock (getTime)", string.format("%.2fs", wall))
    status(px + 14, row + 44, "drift (wall - sim)",   string.format("%.2fs", drift), drift < 0.05)
    status(px + 14, row + 66, "audio source",         sourceState, sourceState == "playing")
    status(px + 14, row + 88, "ball velocity",        string.format("%d,%d", ball.vx, ball.vy))
    status(px + 14, row + 110, "love.thread",         "n/a (no pthreads)", nil)

    love.graphics.setColor(0.55, 0.57, 0.62, 0.85)
    love.graphics.print("click Pause in the strip — sim/audio/ball freeze; wall clock drifts.",
        px + 14, py + ph - 24)
end
