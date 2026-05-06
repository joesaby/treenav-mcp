/**
 * Subcommand dispatch tests for bin.ts.
 *
 * The published `treenav` bin is a single executable that dispatches on
 * argv[2]: `init` → cli-init.main, otherwise → the MCP stdio server.
 * These tests shell out to bin.ts to assert that routing is correct
 * end-to-end.
 *
 * Note: the default (no-subcommand) MCP server path is exercised by the
 * existing mcp-integration test suite, which spawns the server directly.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(import.meta.dir, "..");
const BIN = join(REPO_ROOT, "bin.ts");

describe("bin.ts subcommand dispatch", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "treenav-bin-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("`init --all --dry-run` routes to cli-init", () => {
    const result = spawnSync("bun", [BIN, "init", "--all", "--dry-run"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    // cli-init.ts main() prints "treenav init" as its first line.
    expect(result.stdout).toContain("treenav init");
    expect(result.stdout).toContain("(dry run");
    // It should also list the MCP config paths it would write.
    expect(result.stdout).toContain(".mcp.json");
  });
});
