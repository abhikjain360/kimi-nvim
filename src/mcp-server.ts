#!/usr/bin/env node
/**
 * kimi-nvim MCP Server
 *
 * Connects to Neovim via msgpack-RPC, then starts an MCP server over stdio
 * to service tool requests from kimi-cli.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { attach, NeovimClient } from "neovim";
import { Buffer } from "neovim/lib/api/Buffer.js";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const socketArgIndex = args.indexOf("--nvim-socket");
const nvimSocket =
  socketArgIndex !== -1 ? args[socketArgIndex + 1] : process.env.NVIM_LISTEN_ADDRESS;

if (!nvimSocket) {
  console.error("Missing --nvim-socket or NVIM_LISTEN_ADDRESS");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Neovim connection
// ---------------------------------------------------------------------------

// Prevent the neovim package from hijacking console.log (would break MCP stdio)
const nvim: NeovimClient = attach({
  socket: nvimSocket,
  options: {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (...msgs: unknown[]) => console.warn(...msgs),
      error: (...msgs: unknown[]) => console.error(...msgs),
    } as any,
  },
});

process.on("exit", () => {
  try {
    nvim.quit();
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findBufferByPath(filePath: string): Promise<Buffer | null> {
  const bufs: Buffer[] = await nvim.buffers;
  for (const buf of bufs) {
    const name: string = await nvim.call("bufname", [buf.id]);
    if (name === filePath) {
      return buf;
    }
  }
  // Fallback: bufnr() can find unloaded buffers by name
  const bufnr: number = await nvim.call("bufnr", [filePath]);
  if (bufnr > 0) {
    return new (nvim.Buffer as any)(nvim, bufnr);
  }
  return null;
}

async function readFileFromDisk(filePath: string): Promise<string> {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function severityToString(severity: number): string {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "kimi-nvim",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_current_selection",
        description:
          "Get the current visual selection or cursor position in Neovim. " +
          "Returns the selected text, file path, and line/character range.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "get_current_file",
        description:
          "Get metadata about the currently active buffer in Neovim. " +
          "Returns file path, name, language, and modification status.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "get_open_buffers",
        description:
          "List all open (listed) buffers in Neovim with their file paths. " +
          "Useful to know which files the user is currently editing.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "get_buffer_content",
        description:
          "Read full or partial content of a buffer by file path. " +
          "If the buffer is open in Neovim, returns the in-memory content (including unsaved changes). " +
          "Otherwise reads from disk.",
        inputSchema: {
          type: "object" as const,
          properties: {
            filePath: {
              type: "string",
              description: "Absolute path to the file",
            },
            startLine: {
              type: "number",
              description: "0-based start line (inclusive). Omit for full file.",
            },
            endLine: {
              type: "number",
              description: "0-based end line (exclusive). Omit for full file.",
            },
          },
          required: ["filePath"],
        },
      },
      {
        name: "get_diagnostics",
        description:
          "Get LSP diagnostics (errors, warnings, hints) for a file. " +
          "Returns severity, message, location, and source for each diagnostic.",
        inputSchema: {
          type: "object" as const,
          properties: {
            filePath: {
              type: "string",
              description: "Absolute path to the file",
            },
          },
          required: ["filePath"],
        },
      },
      {
        name: "open_file",
        description:
          "Open a file in Neovim and optionally jump to a specific line and column. " +
          "Useful to navigate the user to relevant code.",
        inputSchema: {
          type: "object" as const,
          properties: {
            filePath: {
              type: "string",
              description: "Absolute path to the file",
            },
            line: {
              type: "number",
              description: "0-based line number to jump to",
            },
            column: {
              type: "number",
              description: "0-based column number to jump to",
            },
          },
          required: ["filePath"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "get_current_selection": {
      const buf: Buffer = await nvim.buffer;
      const filePath: string = await nvim.call("bufname", [buf.id]);
      const mode: string = await nvim.call("mode", []);
      const isVisual = mode === "v" || mode === "V" || mode === "\x16";

      let text = "";
      let startLine = 0;
      let startCharacter = 0;
      let endLine = 0;
      let endCharacter = 0;
      let isEmpty = true;

      if (isVisual && filePath) {
        const startMark: [number, number, number, number] = await nvim.call("getpos", ["'<"]);
        const endMark: [number, number, number, number] = await nvim.call("getpos", ["'>"]);

        startLine = Math.max(0, startMark[1] - 1);
        startCharacter = Math.max(0, startMark[2] - 1);
        endLine = Math.max(0, endMark[1] - 1);
        // For linewise visual, end column is end of line; for charwise, use mark col (inclusive→exclusive)
        const endCol = mode === "V" ? -1 : endMark[2];
        endCharacter = mode === "V" ? 0 : endMark[2];

        try {
          const lines: string[] = await buf.request("nvim_buf_get_text", [
            buf,
            startLine,
            startCharacter,
            endLine,
            endCol,
            {},
          ]);
          text = lines.join("\n");
          isEmpty = text.length === 0;
        } catch {
          // Fallback to full lines if get_text fails
          const lines: string[] = await buf.getLines({
            start: startLine,
            end: endLine + 1,
            strictIndexing: false,
          });
          text = lines.join("\n");
          isEmpty = text.length === 0;
          startCharacter = 0;
          endCharacter = 0;
        }
      } else {
        const cursor: [number, number, number, number] = await nvim.call("getpos", ["."]);
        startLine = cursor[1] - 1;
        startCharacter = cursor[2] - 1;
        endLine = startLine;
        endCharacter = startCharacter;
        isEmpty = true;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              filePath: filePath || "",
              text,
              range: {
                start: { line: startLine, character: startCharacter },
                end: { line: endLine, character: endCharacter },
              },
              isEmpty,
            }),
          },
        ],
      };
    }

    case "get_current_file": {
      const buf: Buffer = await nvim.buffer;
      const filePath: string = await nvim.call("bufname", [buf.id]);
      const modified: boolean = await buf.getOption("modified") as boolean;
      const filetype: string = await buf.getOption("filetype") as string;
      const fileName = filePath.split("/").pop() || "";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              filePath: filePath || "",
              fileName,
              languageId: filetype,
              isModified: modified,
            }),
          },
        ],
      };
    }

    case "get_open_buffers": {
      const bufs: Buffer[] = await nvim.buffers;
      const currentBuf: Buffer = await nvim.buffer;
      const buffers: Array<{
        filePath: string;
        isModified: boolean;
        isActive: boolean;
      }> = [];

      for (const buf of bufs) {
        const listed: boolean = await buf.getOption("buflisted") as boolean;
        if (!listed) continue;

        const name: string = await nvim.call("bufname", [buf.id]);
        if (!name) continue;

        const modified: boolean = await buf.getOption("modified") as boolean;
        buffers.push({
          filePath: name,
          isModified: modified,
          isActive: buf.id === currentBuf.id,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ buffers }),
          },
        ],
      };
    }

    case "get_buffer_content": {
      const filePath = (args as any).filePath as string;
      const startLine = (args as any).startLine as number | undefined;
      const endLine = (args as any).endLine as number | undefined;

      let content = "";
      let lineCount = 0;

      const buf = await findBufferByPath(filePath);
      if (buf) {
        if (typeof startLine === "number" && typeof endLine === "number") {
          const lines: string[] = await buf.getLines({
            start: startLine,
            end: endLine,
            strictIndexing: false,
          });
          content = lines.join("\n");
          lineCount = lines.length;
        } else {
          const lines: string[] = await buf.getLines({
            start: 0,
            end: -1,
            strictIndexing: false,
          });
          content = lines.join("\n");
          lineCount = lines.length;
        }
      } else {
        // Read from disk
        content = await readFileFromDisk(filePath);
        lineCount = content.split("\n").length;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ content, lineCount }),
          },
        ],
      };
    }

    case "get_diagnostics": {
      const filePath = (args as any).filePath as string;
      const buf = await findBufferByPath(filePath);
      const bufnr = buf ? buf.id : 0;

      const diagnostics: Array<{
        severity: string;
        message: string;
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        source: string;
      }> = [];

      if (bufnr > 0) {
        try {
          const diags: Array<{
            severity: number;
            message: string;
            lnum: number;
            col: number;
            end_lnum?: number;
            end_col?: number;
            source?: string;
          }> = (await nvim.executeLua(
            `
            local bufnr = ...
            local diags = vim.diagnostic.get(bufnr)
            local result = {}
            for _, d in ipairs(diags) do
              table.insert(result, {
                severity = d.severity,
                message = d.message,
                lnum = d.lnum,
                col = d.col,
                end_lnum = d.end_lnum,
                end_col = d.end_col,
                source = d.source,
              })
            end
            return result
          `,
            [bufnr]
          )) as any;

          for (const d of diags) {
            diagnostics.push({
              severity: severityToString(d.severity),
              message: d.message,
              range: {
                start: { line: d.lnum, character: d.col },
                end: {
                  line: d.end_lnum ?? d.lnum,
                  character: d.end_col ?? d.col,
                },
              },
              source: d.source || "",
            });
          }
        } catch (err) {
          // Diagnostics may fail if no LSP is attached; return empty
          console.error("Failed to get diagnostics:", err);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ diagnostics }),
          },
        ],
      };
    }

    case "open_file": {
      const filePath = (args as any).filePath as string;
      const line = (args as any).line as number | undefined;
      const column = (args as any).column as number | undefined;

      try {
        await nvim.command("edit " + filePath);
        if (typeof line === "number") {
          await nvim.call("cursor", [line + 1, (column ?? 0) + 1]);
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: String(err) }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive until stdio closes
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
