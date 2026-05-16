local M = {}

local function get_plugin_root()
  local source = debug.getinfo(1, "S").source
  if source:sub(1, 1) == "@" then
    source = source:sub(2)
  end
  return vim.fn.fnamemodify(source, ":p:h:h:h")
end

function M.ensure_built()
  local plugin_root = get_plugin_root()
  local dist_file = plugin_root .. "/dist/mcp-server.js"

  if vim.fn.filereadable(dist_file) == 1 then
    return true
  end

  vim.notify("kimi-nvim: Building MCP server (first time)...", vim.log.levels.INFO)
  local cmd = string.format("cd %s && npm install && npm run build 2>&1", vim.fn.shellescape(plugin_root))
  local output = vim.fn.system(cmd)

  if vim.v.shell_error ~= 0 then
    vim.notify("kimi-nvim: Build failed:\n" .. output, vim.log.levels.ERROR)
    return false
  end

  vim.notify("kimi-nvim: Build complete", vim.log.levels.INFO)
  return true
end

return M
