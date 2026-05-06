import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { generateMcpConfig, detectTools, writeConfigFiles } from "../src/cli-init";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "treenav-init-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true });
});

describe("generateMcpConfig", () => {
  test("claude-code: generates .mcp.json content", () => {
    const result = generateMcpConfig("claude-code");
    const parsed = JSON.parse(result!.content);
    expect(result!.path).toBe(".mcp.json");
    expect(parsed.mcpServers.treenav.command).toBe("bunx");
    expect(parsed.mcpServers.treenav.args).toContain("treenav");
    expect(parsed.mcpServers.treenav.env.DOCS_ROOT).toBe("./docs");
  });

  test("cursor: generates .cursor/mcp.json", () => {
    const result = generateMcpConfig("cursor");
    expect(result!.path).toBe(".cursor/mcp.json");
    const parsed = JSON.parse(result!.content);
    expect(parsed.mcpServers.treenav.env.DOCS_ROOT).toBe("./docs");
  });

  test("windsurf: generates .windsurf/mcp.json", () => {
    const result = generateMcpConfig("windsurf");
    expect(result!.path).toBe(".windsurf/mcp.json");
  });

  test("codex: generates .codex/config.toml with TOML format", () => {
    const result = generateMcpConfig("codex");
    expect(result!.path).toBe(".codex/config.toml");
    expect(result!.content).toContain("[mcp_servers.treenav]");
    expect(result!.content).toContain("DOCS_ROOT");
  });

  test("opencode: generates opencode.json", () => {
    const result = generateMcpConfig("opencode");
    expect(result!.path).toBe("opencode.json");
    const parsed = JSON.parse(result!.content);
    expect(parsed.mcp?.servers?.treenav).toBeDefined();
  });

  test("claude-desktop: returns null (no project file)", () => {
    const result = generateMcpConfig("claude-desktop");
    expect(result).toBeNull();
  });
});

describe("detectTools", () => {
  test("detects claude-code when .mcp.json exists", async () => {
    await Bun.write(join(dir, ".mcp.json"), "{}");
    const tools = detectTools(dir);
    expect(tools).toContain("claude-code");
  });

  test("detects cursor when .cursor dir exists", async () => {
    await mkdir(join(dir, ".cursor"), { recursive: true });
    const tools = detectTools(dir);
    expect(tools).toContain("cursor");
  });

  test("returns empty array when nothing detected", () => {
    expect(detectTools(dir)).toEqual([]);
  });
});

describe("writeConfigFiles", () => {
  test("writes MCP config file for claude-code", async () => {
    const created = await writeConfigFiles(["claude-code"], dir, false);
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
    expect(created.some((c) => c.includes(".mcp.json"))).toBe(true);
  });

  test("does not overwrite existing MCP config", async () => {
    await Bun.write(join(dir, ".mcp.json"), '{"existing": true}');
    await writeConfigFiles(["claude-code"], dir, false);
    const content = await Bun.file(join(dir, ".mcp.json")).text();
    expect(JSON.parse(content).existing).toBe(true);
  });

  test("dry-run: does not write any files", async () => {
    await writeConfigFiles(["claude-code", "cursor"], dir, true);
    expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
    expect(existsSync(join(dir, ".cursor/mcp.json"))).toBe(false);
  });
});
