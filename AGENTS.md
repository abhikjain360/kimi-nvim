# Agent Guidance for kimi-nvim

## Build & Type-checking

- **Use `tsgo` for type-checking. NEVER use `tsc`.**
  - `npm run typecheck` — runs `tsgo --noEmit`
- **Build with `tsup` via npm scripts:**
  - `npm run build` — production bundle to `dist/`
  - `npm run dev` — watch mode
- **Lint / Format with OxC:**
  - `npm run lint` / `npm run lint:fix`
  - `npm run format` / `npm run format:check`
- **Always prefer npm scripts** defined in `package.json` over invoking binaries directly whenever possible.

## Project Overview

kimi-nvim is a Neovim plugin that embeds [kimi-cli](https://github.com/your-org/kimi-cli) in a `:terminal` buffer and exposes editor context to it via the Model Context Protocol (MCP).

### Architecture

```
Neovim
├── lua/kimi/   → Lua plugin (terminal buffer, commands, keymaps, mentions)
└── src/mcp-server.ts  → TS MCP server ↔ stdio ↔ kimi-cli
         ↕ msgpack-RPC
    Neovim API (buffers, selections, diagnostics)
```

- **Lua side** (`lua/kimi/`): plugin initialization, terminal management, Neovim commands (`:Kimi`, `:KimiMention`, etc.), default keymaps, and mention generation (`@file:line-line`).
- **TypeScript side** (`src/mcp-server.ts`): single-file MCP server using `@modelcontextprotocol/sdk`. It connects to Neovim via msgpack-RPC (`neovim` npm package) over a Unix socket (`--nvim-socket` or `NVIM_LISTEN_ADDRESS`), then exposes tools over stdio.

### Entry Points

| Path | Purpose |
|------|---------|
| `src/mcp-server.ts` | Source for the MCP server |
| `dist/mcp-server.js` | Bundled output (CJS, Node 20 target) |
| `bin/kimi-nvim-mcp` | CLI wrapper: `#!/usr/bin/env node` requiring `../dist/mcp-server.js` |
| `lua/kimi/init.lua` | Lua plugin entry point |
| `plugin/kimi.lua` | Neovim `plugin/` bootstrap |

### MCP Tools

The TS server registers these tools for kimi-cli:

- `get_current_selection` — visual selection or cursor position
- `get_current_file` — active buffer metadata
- `get_open_buffers` — listed buffers
- `get_buffer_content` — in-memory (or disk) file content
- `get_diagnostics` — LSP diagnostics via `vim.diagnostic.get`
- `open_file` — navigate Neovim to a file/line/column

### Key Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `neovim` — msgpack-RPC client for Neovim
- `zod` (v4) — runtime schema validation for tool inputs
- `tsup` — bundler
- `@rslint/tsgo` — fast type-checker (replace `tsc`)
- `oxlint` / `oxfmt` — linting and formatting

### Environment Requirements

- Node.js >= 20
- Neovim >= 0.8.0
- `kimi` CLI available in `$PATH`
