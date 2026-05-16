-- MCP server config generation for kimi-nvim
-- Writes the MCP config file that kimi-cli reads to spawn our TS server.

local M = {}

local config_path = nil

local function get_plugin_root()
  local source = debug.getinfo(1, "S").source
  if source:sub(1, 1) == "@" then
    source = source:sub(2)
  end
  return vim.fn.fnamemodify(source, ":p:h:h:h")
end

function M.start(opts)
  opts = opts or {}
  local socket = opts.nvim_socket or vim.v.servername
  if not socket then
    error("kimi-nvim: Neovim socket unavailable. Start nvim with --listen")
  end

  if not require("kimi.build").ensure_built() then
    error("kimi-nvim: MCP server build failed")
  end

  local script_path = opts.script_path or get_plugin_root() .. "/dist/mcp-server.js"

  config_path = vim.fn.stdpath("cache") .. "/kimi-nvim-mcp.json"

  -- Write MCP config for kimi-cli (fastmcp format)
  local cfg = vim.json.encode({
    mcpServers = {
      neovim = {
        command = "node",
        args = { script_path, "--nvim-socket", socket },
      },
    },
  })

  local f = io.open(config_path, "w")
  if f then
    f:write(cfg)
    f:close()
  else
    error("kimi-nvim: failed to write MCP config to " .. config_path)
  end
end

function M.stop()
  if config_path then
    vim.fn.delete(config_path)
    config_path = nil
  end
end

function M.is_running()
  -- The MCP server is spawned by kimi-cli, not by us.
  -- We consider it "configured" when the config file exists.
  return config_path ~= nil and vim.fn.filereadable(config_path) == 1
end

function M.get_config_path()
  return config_path
end

return M
