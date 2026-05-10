-- Breakout -- a Magnetar starter template
-- Copyright (c) 2026 Trynda
-- Released under the MIT License. See LICENSE file for full text.

-- Controls: Move mouse to steer paddle, click or Space to launch, R to reset.

local W, H = 800, 600
local COLS, ROWS = 10, 6
local BW, BH, GAP, TOP = 70, 20, 4, 60
local paddle, ball, bricks, state, lives, score

local function resetBricks()
    bricks = {}
    local startX = (W - (COLS * BW + (COLS - 1) * GAP)) / 2
    for r = 1, ROWS do
        for c = 1, COLS do
            table.insert(bricks, {
                x = startX + (c - 1) * (BW + GAP),
                y = TOP + (r - 1) * (BH + GAP),
                hue = r / ROWS, alive = true,
            })
        end
    end
end

local function resetBall()
    ball = { x = W / 2, y = H - 80, r = 8, vx = 0, vy = 0, stuck = true }
end

local function resetGame()
    paddle = { x = W / 2 - 60, y = H - 40, w = 120, h = 14 }
    resetBall(); resetBricks()
    state, lives, score = "play", 3, 0
end

function love.load()
    love.window.setMode(W, H)
    love.window.setTitle("Breakout")
    resetGame()
end

local function overlap(ax, ay, aw, ah, bx, by, bw, bh)
    return ax < bx + bw and ax + aw > bx and ay < by + bh and ay + ah > by
end

local function launch()
    if ball.stuck then
        ball.stuck = false
        ball.vx, ball.vy = 220, -360
    end
end

function love.update(dt)
    love.mouse.setVisible(not (state == "play" and not ball.stuck))
    if state ~= "play" then return end

    local mx = love.mouse.getX()
    paddle.x = math.max(0, math.min(W - paddle.w, mx - paddle.w / 2))

    if ball.stuck then ball.x = paddle.x + paddle.w / 2; return end

    ball.x = ball.x + ball.vx * dt
    ball.y = ball.y + ball.vy * dt

    if ball.x < ball.r then ball.x, ball.vx = ball.r, -ball.vx end
    if ball.x > W - ball.r then ball.x, ball.vx = W - ball.r, -ball.vx end
    if ball.y < ball.r then ball.y, ball.vy = ball.r, -ball.vy end

    if overlap(ball.x - ball.r, ball.y - ball.r, ball.r * 2, ball.r * 2,
               paddle.x, paddle.y, paddle.w, paddle.h) and ball.vy > 0 then
        ball.vy = -math.abs(ball.vy)
        ball.vx = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2) * 380
    end

    for _, b in ipairs(bricks) do
        if b.alive and overlap(ball.x - ball.r, ball.y - ball.r, ball.r * 2, ball.r * 2,
                               b.x, b.y, BW, BH) then
            b.alive = false; score = score + 10; ball.vy = -ball.vy; break
        end
    end

    if ball.y > H + 20 then
        lives = lives - 1
        if lives <= 0 then state = "lose" else resetBall() end
    end

    local remaining = 0
    for _, b in ipairs(bricks) do if b.alive then remaining = remaining + 1 end end
    if remaining == 0 then state = "win" end
end

function love.keypressed(k)
    if k == "r" then resetGame()
    elseif k == "space" then launch() end
end

function love.mousepressed(_, _, button)
    if button == 1 then launch() end
end

function love.draw()
    love.graphics.clear(0.08, 0.08, 0.12)
    for _, b in ipairs(bricks) do
        if b.alive then
            love.graphics.setColor(0.4 + b.hue * 0.6, 0.7 - b.hue * 0.4, 0.9 - b.hue * 0.3)
            love.graphics.rectangle("fill", b.x, b.y, BW, BH, 3, 3)
        end
    end
    love.graphics.setColor(1, 1, 1)
    love.graphics.rectangle("fill", paddle.x, paddle.y, paddle.w, paddle.h, 4, 4)
    love.graphics.circle("fill", ball.x, ball.y, ball.r)
    love.graphics.print("Score: " .. score, 10, 10)
    love.graphics.print("Lives: " .. lives, W - 80, 10)
    if state == "win" then
        love.graphics.printf("You win! Click or press R to play again.", 0, H / 2, W, "center")
    elseif state == "lose" then
        love.graphics.printf("Game over. Press R to restart.", 0, H / 2, W, "center")
    elseif ball.stuck then
        love.graphics.printf("Click or press Space to launch", 0, H / 2 + 60, W, "center")
    end
end
