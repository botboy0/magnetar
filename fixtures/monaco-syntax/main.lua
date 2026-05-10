-- Monaco syntax fixture
-- Exercises every Monaco token type so you can eyeball the
-- magnetar theme. Load with: magnetar.loadFixture('monaco-syntax')

--[[
  Long-bracket comment.
  Spans multiple lines. Should render in muted-2 italic.
]]

-- ---------- numbers ----------
local int     = 42
local float   = 3.14159
local sci     = 1.5e-3
local hex     = 0xDEADBEEF
local neg     = -7

-- ---------- strings ----------
local single  = 'single quotes'
local double  = "double quotes with \"escape\" and \n newline"
local long    = [[
  long-bracket string
  spans lines, no escapes
]]
local concat  = "hello" .. ", " .. 'world'

-- ---------- keywords + operators ----------
local t = true
local f = false
local n = nil
local everything = not (t and f) or n == nil

-- ---------- function definitions vs calls ----------
local function add(a, b)
  return a + b
end

function love.load()
  -- bare call
  print("monaco syntax fixture loaded")

  -- dotted call chains
  love.graphics.setBackgroundColor(0.04, 0.04, 0.06)
  math.randomseed(os.time())

  -- nested calls + operators
  local r = math.random(1, 100) % 10
  local s = string.format("r=%d, sum=%d", r, add(r, 7))

  -- table constructor + colon call
  local list = { "a", "b", "c" }
  local joined = table.concat(list, ", ")

  -- method call (colon syntax)
  local str = ("padded"):upper()

  print(s, joined, str)
end

-- ---------- control flow ----------
function love.update(dt)
  for i = 1, 3 do
    if i % 2 == 0 then
      -- even
    elseif i == 1 then
      -- first
    else
      -- last
    end
  end

  local j = 0
  while j < 3 do
    j = j + 1
  end

  repeat
    j = j - 1
  until j <= 0
end

-- ---------- draw ----------
function love.draw()
  love.graphics.setColor(0.49, 0.23, 0.93, 1)
  love.graphics.print("hello, magnetar", 20, 20)

  -- length operator
  local items = { 10, 20, 30 }
  love.graphics.print("count: " .. #items, 20, 40)
end
