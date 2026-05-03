-- kimi-nvim
-- Plugin load guard. Actual setup is done via require("kimi").setup() in your config.

if vim.g.loaded_kimi_nvim then
  return
end
vim.g.loaded_kimi_nvim = true

-- Optional auto-setup if the user sets this global before the plugin loads
if vim.g.kimi_nvim_auto_setup then
  require("kimi").setup()
end
