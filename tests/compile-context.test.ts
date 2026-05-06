import { describe, expect, test } from "bun:test";
import type {
  CompileContextInput,
  CompileContextResult,
  CompileContextHit,
  CompileContextOutline,
  CompileContextFullContent,
  ResolvedMode,
  CompileContextSource,
} from "../src/types";

describe("compile_context types", () => {
  test("input shape is well-formed", () => {
    const input: CompileContextInput = {
      intent: "auth token rotation",
      mode: "auto",
      sources: ["docs", "code"],
      filters: { type: "runbook" },
      output: {
        top_k_per_source: 3,
        include_snippets: true,
        include_outlines_for_top: 2,
        include_full_content_for_top: 0,
        max_tokens: 2000,
      },
    };
    expect(input.intent).toBe("auth token rotation");
  });

  test("result shape is well-formed", () => {
    const result: CompileContextResult = {
      intent: "x",
      resolved_mode: "search",
      sources: ["docs"],
      duration_ms: 5,
      hits_by_source: { docs: [], code: [], rows: [] },
      hit_totals_by_source: { docs: 0, code: 0, rows: 0 },
      outlines: [],
      full_content: [],
      trim_notes: [],
      tokens_used_estimate: 0,
      tokens_budget: 2000,
    };
    expect(result.resolved_mode).toBe("search");
  });
});

import { resolveMode } from "../src/compile-context";

describe("resolveMode (auto heuristic)", () => {
  // Lookup-shaped: ALL_CAPS-DIGITS pattern
  test.each([
    ["PROJ-44", "lookup"],
    ["INC-104", "lookup"],
    ["ITEM-1234", "lookup"],
  ])("%s -> lookup", (q, expected) => {
    expect(resolveMode(q)).toBe(expected);
  });

  // Regex-shaped: contains regex metacharacters
  test.each([
    ["^class.*Service$", "grep"],
    ["foo\\sbar", "grep"],
    ["[A-Z]+", "grep"],
    ["foo|bar", "grep"],
    ["(?:foo)", "grep"],
  ])("%s -> grep", (q, expected) => {
    expect(resolveMode(q)).toBe(expected);
  });

  // Symbol-shaped: starts with class/function/interface, or camelCase token
  test.each([
    ["class AuthService", "symbol"],
    ["function parseAuthHeader", "symbol"],
    ["interface UserRepository", "symbol"],
    ["parseAuthHeader", "symbol"],
    ["AuthService", "symbol"],
  ])("%s -> symbol", (q, expected) => {
    expect(resolveMode(q)).toBe(expected);
  });

  // Default: natural-language → search
  test.each([
    ["how do we rotate tokens", "search"],
    ["auth token rotation", "search"],
    ["incident response runbook", "search"],
    ["", "search"],
  ])("%s -> search", (q, expected) => {
    expect(resolveMode(q)).toBe(expected);
  });
});
