-- Magnetar — welcome fixture
-- Try editing! Ctrl+Enter to run.
--
-- Click anywhere to spawn a shape.
-- Press space to clear. Escape to quit.

local shapes = {}
local time = 0

-- Magnetar palette
local palette = {
    {0.49, 0.23, 0.93},  -- violet
    {0.02, 0.71, 0.83},  -- cyan
    {0.75, 0.15, 0.83},  -- magenta
    {0.98, 0.45, 0.09},  -- supernova
}

function love.load()
    love.graphics.setBackgroundColor(0.04, 0.04, 0.06)
    math.randomseed(os.time())

    -- start with a few shapes so it's not empty
    for i = 1, 8 do
        spawn(math.random(50, 750), math.random(50, 550))
    end
end

function spawn(x, y)
    table.insert(shapes, {
        x = x,
        y = y,
        vx = (math.random() - 0.5) * 200,
        vy = (math.random() - 0.5) * 200,
        radius = math.random(15, 40),
        color = palette[math.random(#palette)],
        phase = math.random() * math.pi * 2,
        spin = (math.random() - 0.5) * 4,
        angle = 0,
    })
end

function love.update(dt)
    time = time + dt
    local w, h = love.graphics.getDimensions()

    for _, s in ipairs(shapes) do
        s.x = s.x + s.vx * dt
        s.y = s.y + s.vy * dt
        s.angle = s.angle + s.spin * dt

        -- bounce off walls
        if s.x < s.radius then s.x, s.vx = s.radius, -s.vx end
        if s.x > w - s.radius then s.x, s.vx = w - s.radius, -s.vx end
        if s.y < s.radius then s.y, s.vy = s.radius, -s.vy end
        if s.y > h - s.radius then s.y, s.vy = h - s.radius, -s.vy end
    end
end

function love.draw()
    -- connecting lines between nearby shapes
    love.graphics.setLineWidth(1)
    for i = 1, #shapes do
        for j = i + 1, #shapes do
            local a, b = shapes[i], shapes[j]
            local dx, dy = a.x - b.x, a.y - b.y
            local dist = math.sqrt(dx*dx + dy*dy)
            if dist < 150 then
                local alpha = (1 - dist / 150) * 0.4
                love.graphics.setColor(0.82, 0.84, 0.86, alpha)
                love.graphics.line(a.x, a.y, b.x, b.y)
            end
        end
    end

    -- the shapes themselves, pulsing
    for _, s in ipairs(shapes) do
        local pulse = 1 + math.sin(time * 2 + s.phase) * 0.15
        love.graphics.push()
        love.graphics.translate(s.x, s.y)
        love.graphics.rotate(s.angle)

        -- glow
        love.graphics.setColor(s.color[1], s.color[2], s.color[3], 0.2)
        love.graphics.circle("fill", 0, 0, s.radius * pulse * 1.8)

        -- core
        love.graphics.setColor(s.color[1], s.color[2], s.color[3], 0.9)
        love.graphics.circle("fill", 0, 0, s.radius * pulse)

        -- highlight
        love.graphics.setColor(1, 1, 1, 0.3)
        love.graphics.circle("fill", -s.radius * 0.3, -s.radius * 0.3, s.radius * 0.2)

        love.graphics.pop()
    end

    -- HUD
    love.graphics.setColor(0.82, 0.84, 0.86, 0.8)
    love.graphics.print("shapes: " .. #shapes, 10, 10)
    love.graphics.print("click to spawn / space to clear", 10, 28)
end

function love.mousepressed(x, y, button)
    if button == 1 then
        spawn(x, y)
    end
end