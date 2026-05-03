-- Terminal buffer management for kimi-nvim

local M = {}

local term_buf = nil
local term_win = nil

function M.open(opts)
  opts = opts or {}

  local cmd = opts.cmd or "kimi"
  if opts.mcp_config then
    cmd = cmd .. " --mcp-config-file " .. vim.fn.shellescape(opts.mcp_config)
  end

  -- Reuse existing buffer if possible
  if term_buf and vim.api.nvim_buf_is_valid(term_buf) then
    if not (term_win and vim.api.nvim_win_is_valid(term_win)) then
      vim.cmd("vsplit")
      term_win = vim.api.nvim_get_current_win()
      vim.api.nvim_win_set_buf(term_win, term_buf)
    end
    vim.api.nvim_set_current_win(term_win)
    return
  end

  -- Create new terminal
  vim.cmd("vsplit | terminal " .. cmd)
  term_win = vim.api.nvim_get_current_win()
  term_buf = vim.api.nvim_win_get_buf(term_win)

  -- Set buffer options
  vim.api.nvim_set_option_value("buflisted", false, { buf = term_buf })
  vim.api.nvim_set_option_value("bufhidden", "hide", { buf = term_buf })
  vim.api.nvim_set_option_value("winfixheight", true, { win = term_win })

  -- Clean up state when terminal job exits
  vim.api.nvim_create_autocmd("TermClose", {
    buffer = term_buf,
    once = true,
    callback = function()
      term_buf = nil
      term_win = nil
    end,
  })
end

function M.close()
  if term_win and vim.api.nvim_win_is_valid(term_win) then
    vim.api.nvim_win_close(term_win, true)
    term_win = nil
  end
  if term_buf and vim.api.nvim_buf_is_valid(term_buf) then
    vim.api.nvim_buf_delete(term_buf, { force = true })
    term_buf = nil
  end
end

function M.is_open()
  return term_buf ~= nil and vim.api.nvim_buf_is_valid(term_buf)
end

function M.insert_text(text)
  if not term_buf or not vim.api.nvim_buf_is_valid(term_buf) then
    vim.notify("kimi-nvim: terminal is not open", vim.log.levels.WARN)
    return
  end

  local chan = vim.api.nvim_get_option_value("channel", { buf = term_buf })
  if chan and chan > 0 then
    vim.api.nvim_chan_send(chan, text)
  else
    vim.notify("kimi-nvim: no active terminal channel", vim.log.levels.WARN)
  end
end

return M
