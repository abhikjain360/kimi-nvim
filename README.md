# kimi-nvim

Neovim plugin for **kimi-cli** — embeds kimi in a `:terminal` buffer and exposes editor context via MCP. This is vibecoded slop that seems to work, no guarantee for anything.

## Features

- 🖥️ **Embedded terminal** — run `kimi` inside Neovim's `:terminal`
- 🔌 **MCP tools** — kimi can query open buffers, current file, selections, diagnostics
- 📝 **Mentions** — select code in visual mode and send `@file:line-line` references to kimi
- ⚡ **Standard protocols** — uses MCP over stdio, no proprietary reverse-engineering

## Requirements

- Neovim >= 0.8.0
- **kimi-cli** installed and available in `$PATH`
- Node.js >= 20 (for the MCP server)

## Installation

The plugin **automatically builds the MCP server on first use** (when you run `:Kimi` for the first time). You can also pre-build during installation to avoid the delay.

### lazy.nvim

```lua
{
  "abhikjain360/kimi-nvim",
  build = "npm install && npm run build", -- optional: pre-build so first :Kimi is instant
  config = function()
    require("kimi").setup()
  end,
}
```

Or with auto-setup (no `config` needed):

```lua
{
  "abhikjain360/kimi-nvim",
  build = "npm install && npm run build",
  init = function()
    vim.g.kimi_nvim_auto_setup = true
  end,
}
```

### vim-plug

```vim
Plug 'abhikjain360/kimi-nvim', { 'do': 'npm install && npm run build' }
```

Then in your Lua config:

```lua
require("kimi").setup()
```

## Usage

### Commands

| Command                   | Mode   | Description                                                                           |
| ------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `:Kimi`                   | Normal | Open or toggle the kimi terminal. Generates MCP config and starts kimi with it.       |
| `:KimiClose`              | Normal | Close the kimi terminal and clean up MCP config.                                      |
| `:KimiRestart`            | Normal | Restart the terminal and MCP config.                                                  |
| `:KimiMention`            | Visual | Send an `@file:line-line` reference of the visual selection to the terminal.          |
| `:KimiMentionFile [path]` | Normal | Mention an entire file (or current file if no argument). Supports `<Tab>` completion. |

### Default Keymaps

Set `keymaps = true` in `setup()` (default) to enable:

| Keymap       | Mode   | Action             |
| ------------ | ------ | ------------------ |
| `<leader>kk` | Normal | Toggle `:Kimi`     |
| `<leader>km` | Visual | `:KimiMention`     |
| `<leader>kf` | Normal | `:KimiMentionFile` |

Disable default keymaps:

```lua
require("kimi").setup({ keymaps = false })
```

### Configuration

```lua
require("kimi").setup({
  terminal_cmd = "kimi",           -- command to run in the terminal
  mcp_server_path = nil,           -- path to dist/mcp-server.js (auto-detected by default)
  keymaps = true,                  -- enable default keymaps
  mention_format = "@{file}:{start}-{end}", -- format for @mentions
})
```

### How it works

1. You run `:Kimi` — the plugin builds the MCP server if needed, then writes a temporary MCP config file.
2. A terminal buffer opens running `kimi --mcp-config-file /path/to/config.json`.
3. kimi-cli spawns the MCP server, which connects back to Neovim via msgpack-RPC.
4. When kimi needs context, it calls MCP tools like `get_current_file`, `get_open_buffers`, `get_current_selection`, etc.
5. When you select code and press `<leader>km`, an `@file:line-line` reference is inserted into the terminal buffer.

### Troubleshooting

Run `:checkhealth kimi-nvim` to verify:

- Neovim version (>= 0.8.0)
- Node.js availability
- kimi-cli availability
- MCP server bundle is built
- `require("kimi").setup()` has been called

## Architecture

```
Neovim
├── Lua plugin   → terminal buffer management, commands, keymaps
└── TS MCP server ↔ stdio ↔ kimi-cli
        ↕ msgpack-RPC
    Neovim API (buffers, selections, diagnostics)
```

## MCP Tools exposed to kimi

| Tool                    | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `get_current_selection` | Current visual selection or cursor position                    |
| `get_current_file`      | Metadata about the active buffer                               |
| `get_open_buffers`      | List of all open (listed) buffers                              |
| `get_buffer_content`    | Full or partial content of a buffer (includes unsaved changes) |
| `get_diagnostics`       | LSP diagnostics for a file                                     |
| `open_file`             | Open/navigate to a file in Neovim                              |

## License

MIT
