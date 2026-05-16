-- Mention formatting and terminal insertion

local M = {}

function M.send_visual_selection()
  local buf = vim.api.nvim_get_current_buf()
  local file = vim.api.nvim_buf_get_name(buf)
  if file == "" then
    vim.notify("kimi-nvim: no file name", vim.log.levels.WARN)
    return
  end

  local start_line = vim.fn.line("'<")
  local end_line = vim.fn.line("'>")

  if start_line == 0 or end_line == 0 then
    vim.notify("kimi-nvim: no visual selection", vim.log.levels.WARN)
    return
  end

  -- Make relative to cwd when possible
  local cwd = vim.fn.getcwd()
  local rel_file = file
  if file:sub(1, #cwd) == cwd then
    rel_file = file:sub(#cwd + 2) -- skip cwd + /
  end

  local config = require("kimi").config or {}
  local fmt = config.mention_format or "@{file}:{start}-{end}"
  local mention = fmt:gsub("{file}", rel_file):gsub("{start}", tostring(start_line)):gsub("{end}", tostring(end_line))

  local term = require("kimi.terminal")
  if not term.is_open() then
    vim.notify("kimi-nvim: opening terminal and sending mention…", vim.log.levels.INFO)
    require("kimi").open()
  end

  term.insert_text(mention .. " ")
end

function M.send_file(path)
  if not path or path == "" then
    path = vim.fn.expand("%:p")
  end
  if path == "" then
    vim.notify("kimi-nvim: no file name", vim.log.levels.WARN)
    return
  end

  -- Make relative to cwd when possible
  local cwd = vim.fn.getcwd()
  local rel_file = path
  if path:sub(1, #cwd) == cwd then
    rel_file = path:sub(#cwd + 2)
  end

  local config = require("kimi").config or {}
  local fmt = (config.mention_format or "@{file}:{start}-{end}"):gsub(":{start}-{end}", "")
  local mention = fmt:gsub("{file}", rel_file)

  local term = require("kimi.terminal")
  if not term.is_open() then
    vim.notify("kimi-nvim: opening terminal and sending mention…", vim.log.levels.INFO)
    require("kimi").open()
  end

  term.insert_text(mention .. " ")
end

return M
