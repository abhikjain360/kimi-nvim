-- Neovim commands and keymaps for kimi-nvim

local M = {}

function M.create_commands()
  vim.api.nvim_create_user_command("Kimi", function()
    require("kimi").open()
  end, {})

  vim.api.nvim_create_user_command("KimiClose", function()
    require("kimi").close()
  end, {})

  vim.api.nvim_create_user_command("KimiRestart", function()
    require("kimi").close()
    vim.defer_fn(function()
      require("kimi").open()
    end, 200)
  end, {})

  vim.api.nvim_create_user_command("KimiMention", function()
    require("kimi.mention").send_visual_selection()
  end, { range = true })

  vim.api.nvim_create_user_command("KimiMentionFile", function(opts)
    local path = opts.args ~= "" and opts.args or vim.fn.expand("%:p")
    require("kimi.mention").send_file(path)
  end, {
    nargs = "?",
    complete = "file",
  })
end

function M.set_keymaps()
  vim.keymap.set("n", "<leader>kk", "<cmd>Kimi<cr>", { desc = "Toggle kimi terminal" })
  vim.keymap.set("v", "<leader>km", "<cmd>KimiMention<cr>", { desc = "Mention selection" })
  vim.keymap.set("n", "<leader>kf", "<cmd>KimiMentionFile<cr>", { desc = "Mention current file" })
end

return M
