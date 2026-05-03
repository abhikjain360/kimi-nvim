-- checkhealth integration for kimi-nvim

local M = {}

local function check_executable(name, min_version, version_flag)
  local ok = vim.fn.executable(name) == 1
  if not ok then
    vim.health.error(("`%s` not found in $PATH"):format(name))
    return false
  end

  local version = ""
  if version_flag then
    local out = vim.fn.system({ name, version_flag })
    version = vim.split(out or "", "\n", { plain = true })[1] or ""
    version = vim.trim(version)
  end

  local msg = ("`%s` found"):format(name)
  if version ~= "" then
    msg = msg .. (" (%s)"):format(version)
  end
  vim.health.ok(msg)
  return true
end

function M.check()
  vim.health.start("kimi-nvim")

  -- Neovim version
  local nvim_version = vim.version()
  local nvim_ok = nvim_version.major > 0 or nvim_version.minor >= 8
  if nvim_ok then
    vim.health.ok(("Neovim %d.%d.%d"):format(nvim_version.major, nvim_version.minor, nvim_version.patch))
  else
    vim.health.error(("Neovim %d.%d.%d (requires >= 0.8.0)"):format(nvim_version.major, nvim_version.minor, nvim_version.patch))
  end

  -- Node.js
  local node_ok = check_executable("node", nil, "--version")

  -- kimi CLI
  local kimi = require("kimi")
  local terminal_cmd = (kimi.config or {}).terminal_cmd or "kimi"
  check_executable(terminal_cmd, nil, "--version")

  -- MCP server bundle
  local plugin_root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h:h:h")
  local script_path = (kimi.config or {}).mcp_server_path or (plugin_root .. "/dist/mcp-server.js")
  if vim.fn.filereadable(script_path) == 1 then
    vim.health.ok(("MCP server bundle found at `%s`"):format(script_path))
  else
    vim.health.error(("MCP server bundle not found at `%s`. Run `npm run build`."):format(script_path))
  end

  -- Plugin setup
  if kimi.config and next(kimi.config) ~= nil then
    vim.health.ok("`require('kimi').setup()` has been called")
  else
    vim.health.warn("`require('kimi').setup()` has not been called")
  end
end

return M
