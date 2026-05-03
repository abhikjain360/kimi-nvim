-- kimi-nvim
-- Main entry point for the Neovim Lua plugin

local M = {}

M.config = {}

function M.setup(opts)
  opts = opts or {}

  M.config = vim.tbl_deep_extend("force", {
    terminal_cmd = "kimi",
    mcp_server_path = nil, -- auto-detect
    keymaps = true,
    mention_format = "@{file}:{start}-{end}",
  }, opts)

  require("kimi.commands").create_commands()

  if M.config.keymaps then
    require("kimi.commands").set_keymaps()
  end

  -- Clean up MCP config on exit
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = vim.api.nvim_create_augroup("KimiNvimCleanup", { clear = true }),
    callback = function()
      require("kimi.mcp-server").stop()
    end,
  })
end

function M.open()
  local mcp = require("kimi.mcp-server")
  local term = require("kimi.terminal")

  if not mcp.is_running() then
    mcp.start({
      nvim_socket = vim.v.servername,
      script_path = M.config.mcp_server_path,
    })
  end

  term.open({
    cmd = M.config.terminal_cmd,
    mcp_config = mcp.get_config_path(),
  })
end

function M.close()
  require("kimi.terminal").close()
  require("kimi.mcp-server").stop()
end

return M
