/**
 * Init CLI — configures AI tools to use treenav for documentation search.
 *
 * Usage:
 *   bunx treenav init           # interactive tool selection
 *   bunx treenav init --all     # configure all supported tools
 *   bunx treenav init --dry-run # print actions without writing
 */

import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as readline from "node:readline/promises";

export type Tool =
  | "claude-code"
  | "cursor"
  | "windsurf"
  | "codex"
  | "opencode"
  | "claude-desktop";

export const TOOL_LABELS: Record<Tool, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  codex: "Codex CLI",
  opencode: "OpenCode",
  "claude-desktop": "Claude Desktop (read-only, manual setup)",
};

const MCP_ENV = {
  DOCS_ROOT: "./docs",
};

const MCP_JSON_SERVER = {
  command: "bunx",
  args: ["treenav"],
  env: MCP_ENV,
};

interface GeneratedFile {
  path: string;
  content: string;
}

export function generateMcpConfig(tool: Tool): GeneratedFile | null {
  switch (tool) {
    case "claude-code":
      return {
        path: ".mcp.json",
        content: JSON.stringify({ mcpServers: { treenav: MCP_JSON_SERVER } }, null, 2),
      };
    case "cursor":
      return {
        path: ".cursor/mcp.json",
        content: JSON.stringify({ mcpServers: { treenav: MCP_JSON_SERVER } }, null, 2),
      };
    case "windsurf":
      return {
        path: ".windsurf/mcp.json",
        content: JSON.stringify({ mcpServers: { treenav: MCP_JSON_SERVER } }, null, 2),
      };
    case "opencode":
      return {
        path: "opencode.json",
        content: JSON.stringify(
          {
            mcp: {
              servers: {
                treenav: { command: "bunx", args: ["treenav"], env: MCP_ENV },
              },
            },
          },
          null,
          2
        ),
      };
    case "codex":
      return {
        path: ".codex/config.toml",
        content: [
          "[mcp_servers.treenav]",
          `command = "bunx"`,
          `args = ["treenav"]`,
          "",
          "[mcp_servers.treenav.env]",
          `DOCS_ROOT = "${MCP_ENV.DOCS_ROOT}"`,
        ].join("\n"),
      };
    case "claude-desktop":
      return null;
  }
}

export function detectTools(root: string): Tool[] {
  const detected: Tool[] = [];
  if (existsSync(join(root, ".mcp.json")) || existsSync(join(root, ".claude")))
    detected.push("claude-code");
  if (existsSync(join(root, ".cursor"))) detected.push("cursor");
  if (existsSync(join(root, ".windsurf")) || existsSync(join(root, ".windsurfrules")))
    detected.push("windsurf");
  if (existsSync(join(root, "AGENTS.md")) || existsSync(join(root, ".codex")))
    detected.push("codex");
  if (existsSync(join(root, "opencode.json")) || existsSync(join(root, ".opencode")))
    detected.push("opencode");
  return detected;
}

export async function writeConfigFiles(
  tools: Tool[],
  root: string,
  dryRun: boolean
): Promise<string[]> {
  const created: string[] = [];

  for (const tool of tools) {
    const mcp = generateMcpConfig(tool);
    if (mcp) {
      const absPath = join(root, mcp.path);
      if (!existsSync(absPath)) {
        if (!dryRun) {
          await mkdir(dirname(absPath), { recursive: true });
          await writeFile(absPath, mcp.content);
        }
        created.push(mcp.path);
      }
    }
  }

  return created;
}

async function promptTools(detected: Tool[]): Promise<Tool[]> {
  const allTools: Tool[] = [
    "claude-code", "cursor", "windsurf", "codex", "opencode", "claude-desktop",
  ];

  console.log("\nWhich AI tools do you use in this project?");
  allTools.forEach((tool, i) => {
    const mark = detected.includes(tool) ? " (detected)" : "";
    console.log(`  [${i + 1}] ${TOOL_LABELS[tool]}${mark}`);
  });
  console.log();

  const defaultNums =
    detected.length > 0
      ? detected.map((t) => String(allTools.indexOf(t) + 1)).join(" ")
      : "1";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(
    `Enter numbers separated by spaces [${defaultNums}]: `
  );
  rl.close();

  if (answer.trim() === "") {
    return detected.length > 0 ? detected : ["claude-code"];
  }

  return answer
    .trim()
    .split(/\s+/)
    .map((n) => parseInt(n, 10) - 1)
    .filter((i) => i >= 0 && i < allTools.length)
    .map((i) => allTools[i]);
}

export async function main() {
  const args = Bun.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const all = args.includes("--all");
  const root = process.cwd();

  console.log("treenav init");
  if (dryRun) console.log("(dry run — no files will be written)\n");

  const detected = detectTools(root);
  const tools: Tool[] = all
    ? ["claude-code", "cursor", "windsurf", "codex", "opencode"]
    : await promptTools(detected);

  const configured = await writeConfigFiles(tools, root, dryRun);

  if (tools.includes("claude-desktop")) {
    console.log("\nClaude Desktop — add to ~/Library/Application Support/Claude/claude_desktop_config.json:");
    console.log(JSON.stringify(
      { mcpServers: { treenav: { command: "bunx", args: ["treenav"], env: { DOCS_ROOT: "/absolute/path/to/docs" } } } },
      null, 2
    ));
  }

  if (configured.length === 0) {
    console.log("\nAll configs already exist — nothing to do.");
  } else {
    console.log("\nCreated:");
    for (const f of configured) console.log(`  ${f}`);
  }

  console.log("\nNext steps:");
  console.log("  1. Restart your AI tool to pick up the new MCP config");
  console.log('  2. Ask your agent: "Search the docs for X" or "Show me the tree of Y"');
}

if (import.meta.main) {
  main().catch(console.error);
}
