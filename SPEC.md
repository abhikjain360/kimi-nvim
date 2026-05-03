# kimi-nvim — Design Specification

## Overview

A Neovim plugin that embeds **kimi-cli** in a terminal buffer and exposes editor context (buffers, selections, diagnostics) to it via a **local MCP server** written in TypeScript.

Unlike `claudecode.nvim` (which relies on Claude Code's proprietary WebSocket IDE protocol), this plugin uses **standard MCP over stdio** — the same protocol kimi-cli already supports natively.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Neovim                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ :terminal        │  │ Lua plugin       │  │ TS MCP Server    │  │
│  │ (kimi process)   │  │ (bootstrap + UX) │  │ (stdio ↔ RPC)    │  │
│  │                  │  │                  │  │                  │  │
│  │  ┌──────────┐    │  │  ┌──────────┐    │  │  ┌──────────┐   │  │
│  │  │ kimi-cli │◄───┼──┼──┤ MCP stdio│◄───┼──┼──┤  Server  │   │  │
│  │  │          │    │  │  │          │    │  │  │          │   │  │
│  │  └──────────┘    │  │  └──────────┘    │  │  └────┬─────┘   │  │
│  └──────────────────┘  └──────────────────┘  │       │         │  │
│                                              │  msgpack-RPC   │  │
│                                              │       ▼        │  │
│                                              │  ┌──────────┐  │  │
│                                              │  │  Nvim    │  │  │
│                                              │  │  API     │  │  │
│                                              │  └──────────┘  │  │
│                                              └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Two processes, one plugin

| Component | Language | Role | Lifecycle |
|-----------|----------|------|-----------|
| **Neovim Lua plugin** | Lua | Commands, keymaps, terminal buffer management, mention insertion | Starts/stops with `:Kimi` |
| **MCP server** | TypeScript (Node/Bun) | Speaks MCP stdio to kimi-cli; queries Neovim state via msgpack-RPC | Started by Lua plugin before `kimi` |

The MCP server is **not** a remote Neovim plugin — it is a standalone process that connects *to* Neovim's existing RPC socket to read editor state on demand.

---

## How It Works Inside Neovim

### 1. Boot sequence (`:Kimi`)

```lua
-- lua/kimi/init.lua
function M.open()
  -- 1. Ensure MCP server is running
  if not mcp_server.is_running() then
    mcp_server.start({
      nvim_socket = vim.v.servername,  -- e.g. /tmp/nvim.sock
    })
  end

  -- 2. Open or focus terminal buffer
  terminal.open({
    cmd = "kimi --mcp-config-file " .. mcp_server.config_path,
  })
end
```

The MCP server writes a temporary JSON config file (e.g. `/tmp/kimi-nvim-mcp.json`) that points to itself:

```json
{
  "servers": {
    "neovim": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/kimi-nvim/dist/mcp-server.js",
        "--nvim-socket",
        "/tmp/nvim.sock"
      ]
    }
  }
}
```

### 2. Context query pipeline

When kimi-cli needs context, the flow is:

1. **kimi-cli** → sends `tools/call` over stdio to the MCP server
2. **MCP server** → receives the request, connects to Neovim via `nvim_get_current_buf`, `nvim_buf_get_lines`, etc.
3. **Neovim** → returns raw buffer/selection data
4. **MCP server** → formats into MCP tool result, returns to kimi-cli

### 3. Mention pipeline (user-initiated)

Since MCP stdio is request/response (no server→client push), **mentions are handled by direct terminal buffer manipulation**:

```lua
-- User selects lines 10-20 in src/foo.ts, presses <leader>km
function M.mention_visual()
  local start_line = vim.fn.line("'<")
  local end_line = vim.fn.line("'>")
  local file = vim.fn.expand("%:p")
  local mention = string.format("@%s:%d-%d", file, start_line, end_line)

  -- Insert into terminal buffer where kimi is running
  terminal.insert_text(mention)
end
```

The user can then add natural language around the mention in the terminal.

---

## MCP Server API

The TypeScript MCP server exposes the following tools using `@modelcontextprotocol/sdk`.

### `get_current_selection`

Returns the current visual selection or cursor position.

**Input:** `{}`

**Output:**
```json
{
  "filePath": "/abs/path/to/file.ts",
  "text": "selected text content",
  "range": {
    "start": { "line": 10, "character": 4 },
    "end": { "line": 15, "character": 20 }
  },
  "isEmpty": false
}
```

**Neovim RPC calls:**
- `nvim_get_current_buf` → `nvim_buf_get_name`
- `nvim_get_mode` (check if visual mode)
- `nvim_buf_get_mark` (for `'<` and `'>`)
- `nvim_buf_get_lines`

---

### `get_current_file`

Returns metadata about the current buffer.

**Input:** `{}`

**Output:**
```json
{
  "filePath": "/abs/path/to/file.ts",
  "fileName": "file.ts",
  "languageId": "typescript",
  "isModified": true
}
```

---

### `get_open_buffers`

Returns all listed buffers with their paths.

**Input:** `{}`

**Output:**
```json
{
  "buffers": [
    { "filePath": "/abs/path/a.ts", "isModified": false, "isActive": true },
    { "filePath": "/abs/path/b.ts", "isModified": true,  "isActive": false }
  ]
}
```

**Neovim RPC calls:**
- `nvim_list_bufs` → filter `buflisted` → `nvim_buf_get_name`, `nvim_buf_get_option('modified')`

---

### `get_buffer_content`

Returns full or ranged content of a specific file/buffer.

**Input:**
```json
{
  "filePath": "/abs/path/to/file.ts",
  "startLine": 0,
  "endLine": 50
}
```

**Output:**
```json
{
  "content": "export function foo() {\n  return 42;\n}",
  "lineCount": 50
}
```

---

### `get_diagnostics`

Returns LSP diagnostics for a buffer.

**Input:**
```json
{ "filePath": "/abs/path/to/file.ts" }
```

**Output:**
```json
{
  "diagnostics": [
    {
      "severity": "error",
      "message": "Type 'string' is not assignable to type 'number'",
      "range": { "start": { "line": 5, "character": 10 }, "end": { "line": 5, "character": 15 } },
      "source": "typescript"
    }
  ]
}
```

**Neovim RPC calls:**
- `nvim_exec_lua` → `vim.diagnostic.get(bufnr)`

---

### `open_file` (optional)

Allows the agent to open/navigate to a file in Neovim.

**Input:**
```json
{
  "filePath": "/abs/path/to/file.ts",
  "line": 42,
  "column": 10
}
```

**Output:** `{ "success": true }`

**Implementation:** Sends an RPC notification to a Lua handler that calls `nvim_command('edit ' .. path)` and `nvim_win_set_cursor`.

---

## Neovim Commands

| Command | Mode | Description |
|---------|------|-------------|
| `:Kimi` | Normal | Open or toggle the kimi terminal. Starts MCP server if needed. |
| `:KimiClose` | Normal | Close the kimi terminal and stop the MCP server. |
| `:KimiRestart` | Normal | Restart MCP server and kimi process. |
| `:KimiMention` | Visual | Insert an `@file:line-line` reference into the terminal buffer. |
| `:KimiMentionFile [path]` | Normal | Mention an entire file (or current file if no arg). |
| `:KimiAddSelection` | Visual | Same as `:KimiMention` (alias). |

### Default Keymaps (optional, behind `setup({ keymaps = true })`)

| Keymap | Mode | Action |
|--------|------|--------|
| `<leader>kk` | Normal | Toggle `:Kimi` |
| `<leader>km` | Visual | `:KimiMention` |
| `<leader>kf` | Normal | `:KimiMentionFile` |

---

## Pipeline Detail: A Full Interaction

```
User presses <leader>kk
│
▼
Lua plugin:
  1. Spawns TS MCP server process
     args: ["--nvim-socket", "/tmp/nvim.sock"]
│
▼
TS MCP Server:
  2. Starts MCP Server over stdio
  3. Connects to Neovim via msgpack-RPC
  4. Writes /tmp/kimi-nvim-mcp.json
│
▼
Lua plugin:
  5. Opens :terminal buffer
  6. Runs: kimi --mcp-config-file /tmp/kimi-nvim-mcp.json
│
▼
kimi-cli:
  7. Loads MCP server from JSON config
  8. Sends initialize + tools/list handshake
│
▼
User types: "fix the bug in the current file"
│
▼
kimi-cli (agent loop):
  9. LLM decides to call get_current_file + get_diagnostics
 10. Sends tools/call to MCP server over stdio
│
▼
TS MCP Server:
 11. Receives tool call
 12. RPC → Neovim: nvim_get_current_buf, vim.diagnostic.get(...)
 13. Formats response JSON
 14. Returns result to kimi-cli
│
▼
kimi-cli:
 15. LLM generates fix
 16. Asks user for approval to apply edit (or uses file tool)
│
▼
User selects lines 10-20, presses <leader>km
│
▼
Lua plugin:
 17. Formats mention: @/abs/path/file.ts:10-20
 18. Inserts text into terminal buffer at cursor position
│
▼
User continues chatting in terminal...
```

---

## Recommended Libraries

### TypeScript / MCP Server

| Library | Purpose | Why |
|---------|---------|-----|
| `@modelcontextprotocol/sdk` | MCP server implementation | Official SDK; handles stdio transport, JSON-RPC framing, tool registration |
| `neovim` (npm) | msgpack-RPC client for Neovim | Official Node client; `attach({ socket: '/tmp/nvim.sock' })` |
| `msgpack-lite` | Alternative msgpack parser | Lighter weight if `neovim` package is too heavy |
| `zod` | Runtime schema validation | Validate MCP tool inputs before sending to Neovim |
| `commander` or `cac` | CLI argument parsing | For `--nvim-socket`, `--port`, etc. |

### Lua / Neovim Plugin

| Library | Purpose | Why |
|---------|---------|-----|
| `snacks.nvim` (optional) | Terminal management | If available, use `Snacks.terminal()` for better UX; fallback to native `:terminal` |
| Built-in `vim.api` | Buffer/terminal manipulation | No deps needed for core functionality |

### Build / Distribution

| Tool | Purpose |
|------|---------|
| `bun` or `node` | Runtime for MCP server |
| `esbuild` or `tsup` | Bundle TS → single `.js` file for distribution |
| `lazy.nvim` | Plugin manager target (standard for modern Neovim) |

---

## File Layout

```
kimi-nvim/
├── README.md
├── SPEC.md                    # This file
├── package.json               # TS deps + build scripts
├── tsconfig.json
├── lua/
│   └── kimi/
│       ├── init.lua           # setup(), open(), close()
│       ├── config.lua         # Defaults, validation
│       ├── terminal.lua       # Buffer management, :terminal, snacks fallback
│       ├── commands.lua       # :Kimi, :KimiMention, etc.
│       ├── mcp-server.lua     # Spawns/kills the TS MCP server, writes JSON config
│       └── mention.lua        # Format & insert @mentions into terminal buffer
├── src/
│   ├── mcp-server.ts          # Entrypoint: parses args, starts MCP server, attaches to Nvim
│   ├── nvim-client.ts         # Thin wrapper around neovim npm client
│   ├── index.ts               # Re-exports
│   └── tools/
│       ├── get-current-selection.ts
│       ├── get-current-file.ts
│       ├── get-open-buffers.ts
│       ├── get-buffer-content.ts
│       ├── get-diagnostics.ts
│       └── open-file.ts
├── dist/                      # Compiled JS (bundled, committed or generated on install)
└── bin/
    └── kimi-nvim-mcp          # Shell wrapper: node dist/mcp-server.js "$@"
```

---

## Design Decisions

### Why TypeScript for the MCP server?

- Official MCP SDK is first-class in TypeScript
- Type-safe tool schemas with Zod
- Easy to bundle to a single file with `esbuild`
- `neovim` npm package provides robust msgpack-RPC

### Why not denops.vim?

`denops.vim` lets you write the whole plugin in TypeScript, but:
- It requires users to have Deno installed
- The Denops runtime owns the stdio channel, making it awkward to also run an MCP stdio server in the same process
- Keeping the MCP server as a standalone child process is simpler and matches how other MCP servers work

### Why not push model for selections?

Standard MCP over stdio does not support server-initiated notifications to the client during an idle state. The agent must explicitly ask for context. This is actually *simpler* than claudecode's debounced push model — no background timers, no event flooding.

### Why direct terminal buffer manipulation for mentions?

Without a bidirectional push channel (like Claude's WebSocket), the only way to inject user intent into an ongoing terminal session is to write text into the terminal buffer. This is the same UX as the user manually typing — the agent sees it on the next turn.

---

## Future Extensions

- **ACP mode**: Add a `:KimiACP` command that launches `kimi acp` and speaks the ACP protocol natively in Lua (no terminal buffer). Much more work but enables a fully custom UI.
- **Diff view**: When kimi edits files, open a diff buffer via `open_file` + `nvim_diffthis` instead of silent writes.
- **Mention preview**: Floating window showing what will be mentioned before insertion.
- **Tree explorer integration**: `:KimiMentionTree` for neo-tree / nvim-tree selections (like claudecode's integrations).
