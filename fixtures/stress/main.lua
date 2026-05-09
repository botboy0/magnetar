-- Magnetar — fps stress fixture (manual)
--
-- Not the default fixture. Load via the editor console:
--   await magnetar.loadFixture('stress')
--
-- Drive load from the editor's devtools console (top frame):
--   magnetar.writeFile('/stress', '500')
-- Bump the number until fps drops visibly.
-- The fixture polls /stress each frame and ramps shape count to match.
-- Each shape adds an O(n) per-frame pair check, so cost scales as n².

local shapes = {}
local target = 0

local function spawn()
    table.insert(shapes, {
        x = math.random(50, 750),
        y = math.random(50, 550),
        vx = (math.random() - 0.5) * 200,
        vy = (math.random() - 0.5) * 200,
        r = math.random(8, 16),
    })
end

function love.load()
    love.graphics.setBackgroundColor(0.04, 0.04, 0.06)
end

function love.update(dt)
    -- Poll the count file the console writes.
    local f = io.open("/stress", "r")
    if f then
        local n = tonumber(f:read("*a"))
        f:close()
        if n then target = math.max(0, math.floor(n)) end
    end

    while #shapes < target do spawn() end
    while #shapes > target do table.remove(shapes) end

    local w, h = love.graphics.getDimensions()
    for _, s in ipairs(shapes) do
        s.x = s.x + s.vx * dt
        s.y = s.y + s.vy * dt
        if s.x < s.r or s.x > w - s.r then s.vx = -s.vx end
        if s.y < s.r or s.y > h - s.r then s.vy = -s.vy end
    end
end

function love.draw()
    -- O(n²) pair work to make fps drop visibly with target.
    love.graphics.setColor(0.82, 0.84, 0.86, 0.15)
    for i = 1, #shapes do
        for j = i + 1, #shapes do
            local a, b = shapes[i], shapes[j]
            local dx, dy = a.x - b.x, a.y - b.y
            if dx*dx + dy*dy < 10000 then
                love.graphics.line(a.x, a.y, b.x, b.y)
            end
        end
    end

    love.graphics.setColor(0.49, 0.23, 0.93, 0.9)
    for _, s in ipairs(shapes) do
        love.graphics.circle("fill", s.x, s.y, s.r)
    end

    love.graphics.setColor(1, 1, 1, 0.9)
    love.graphics.print("shapes: " .. #shapes .. " / target: " .. target, 10, 10)
    love.graphics.print('FS.writeFile("/stress", "<n>") in console', 10, 28)
end
