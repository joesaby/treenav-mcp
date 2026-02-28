/**
 * Rust source file parser
 *
 * Handles Rust-specific syntax:
 * - `pub struct Name { ... }` → kind="class"
 * - `pub enum Name { ... }` → kind="enum"
 * - `pub trait Name { ... }` → kind="interface"
 * - `impl Name { ... }` → methods become children of Name
 * - `impl Trait for Name { ... }` → methods become children of Name
 * - `pub fn name(...)` at top level → kind="function", parent_id=null
 * - `pub const / pub static` → kind="variable"
 * - `pub type Name = ...` → kind="type"
 * - Exported = has `pub` (or `pub(crate)` etc.) prefix
 *
 * Two-pass approach:
 *   Pass 1: collect named type declarations (struct, enum, trait)
 *           so impl-block methods can link back to their parent type id.
 *   Pass 2: process impl blocks and top-level fn/const/static/type aliases.
 */
import type { CodeSymbol } from "../code-indexer";

/** Supported file extensions for this parser */
export const RUST_EXTENSIONS = new Set([".rs"]);

/**
 * Parse a Rust source file into code symbols.
 *
 * Extracts:
 *  - Struct declarations (kind="class")
 *  - Enum declarations (kind="enum")
 *  - Trait declarations (kind="interface")
 *  - impl methods, linked as children of their type (kind="method")
 *  - Top-level functions (kind="function")
 *  - pub const / pub static (kind="variable")
 *  - pub type aliases (kind="type")
 */
export function parseRust(source: string, docId: string): CodeSymbol[] {
  const lines = source.split("\n");
  const symbols: CodeSymbol[] = [];
  let counter = 0;

  // ── Pass 1: collect named type declarations ──────────────────────
  // Build a map of typeName → id so impl blocks can link methods to them.
  const typeIds = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("///") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    if (trimmed.startsWith("#[") || trimmed.startsWith("#!")) continue;

    const structMatch = trimmed.match(/^pub(?:\([^)]*\))?\s+struct\s+(\w+)/) || trimmed.match(/^struct\s+(\w+)/);
    const enumMatch   = trimmed.match(/^pub(?:\([^)]*\))?\s+enum\s+(\w+)/)   || trimmed.match(/^enum\s+(\w+)/);
    const traitMatch  = trimmed.match(/^pub(?:\([^)]*\))?\s+trait\s+(\w+)/)  || trimmed.match(/^trait\s+(\w+)/);

    const typeMatch = structMatch || enumMatch || traitMatch;
    if (typeMatch) {
      const name = typeMatch[1];
      const kind: "class" | "enum" | "interface" = structMatch ? "class" : enumMatch ? "enum" : "interface";
      const blockEnd = findBraceBlockEnd(lines, i);
      counter++;
      const id = `${docId}:n${counter}`;
      typeIds.set(name, id);
      symbols.push({
        id,
        name,
        kind,
        signature: trimmed.replace(/\{?\s*$/, "").trim(),
        content: lines.slice(i, blockEnd + 1).join("\n"),
        line_start: i + 1,
        line_end: blockEnd + 1,
        exported: /^pub\b/.test(trimmed),
        children_ids: [],
        parent_id: null,
      });
      i = blockEnd;
    }
  }

  // ── Pass 2: impl blocks, top-level functions, consts, type aliases ──

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("///") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    if (trimmed.startsWith("#[") || trimmed.startsWith("#!")) continue;

    // Skip already-parsed struct/enum/trait declarations
    if (trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+\w+/)) {
      i = findBraceBlockEnd(lines, i);
      continue;
    }

    // --- impl Trait for Type { ... } ---
    const implForMatch = trimmed.match(/^impl(?:<[^>]*>)?\s+\w+(?:<[^>]*>)?\s+for\s+(\w+)/);
    if (implForMatch) {
      const typeName = implForMatch[1];
      const parentId = typeIds.get(typeName) ?? null;
      const blockEnd = findBraceBlockEnd(lines, i);
      parseFnsInBlock(lines, i + 1, blockEnd, docId, parentId, symbols, () => { counter++; return counter; });
      i = blockEnd;
      continue;
    }

    // --- impl Name { ... } ---
    const implMatch = trimmed.match(/^impl(?:<[^>]*>)?\s+(\w+)/);
    if (implMatch) {
      const typeName = implMatch[1];
      const parentId = typeIds.get(typeName) ?? null;
      const blockEnd = findBraceBlockEnd(lines, i);
      parseFnsInBlock(lines, i + 1, blockEnd, docId, parentId, symbols, () => { counter++; return counter; });
      i = blockEnd;
      continue;
    }

    // --- Top-level pub fn / fn ---
    const fnMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const blockEnd = findBraceBlockEnd(lines, i);
      counter++;
      symbols.push({
        id: `${docId}:n${counter}`,
        name,
        kind: "function",
        signature: trimmed.replace(/\{?\s*$/, "").trim(),
        content: lines.slice(i, blockEnd + 1).join("\n"),
        line_start: i + 1,
        line_end: blockEnd + 1,
        exported: /^pub\b/.test(trimmed),
        children_ids: [],
        parent_id: null,
      });
      i = blockEnd;
      continue;
    }

    // --- pub const / const / pub static / static ---
    const constMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(\w+)/);
    if (constMatch) {
      const name = constMatch[1];
      // Find end of statement (semicolon)
      let end = i;
      while (end < lines.length - 1 && !lines[end].includes(";")) end++;
      counter++;
      symbols.push({
        id: `${docId}:n${counter}`,
        name,
        kind: "variable",
        signature: trimmed.replace(/;?\s*$/, "").trim(),
        content: lines.slice(i, end + 1).join("\n"),
        line_start: i + 1,
        line_end: end + 1,
        exported: /^pub\b/.test(trimmed),
        children_ids: [],
        parent_id: null,
      });
      i = end;
      continue;
    }

    // --- pub type Name = ... ---
    const typeAliasMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)/);
    if (typeAliasMatch) {
      const name = typeAliasMatch[1];
      let end = i;
      while (end < lines.length - 1 && !lines[end].includes(";")) end++;
      counter++;
      symbols.push({
        id: `${docId}:n${counter}`,
        name,
        kind: "type",
        signature: trimmed.replace(/;?\s*$/, "").trim(),
        content: lines.slice(i, end + 1).join("\n"),
        line_start: i + 1,
        line_end: end + 1,
        exported: /^pub\b/.test(trimmed),
        children_ids: [],
        parent_id: null,
      });
      i = end;
    }
  }

  return symbols;
}

/**
 * Parse fn declarations inside an impl block.
 * Links each method to parentId (if non-null) and pushes to symbols.
 */
function parseFnsInBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  docId: string,
  parentId: string | null,
  symbols: CodeSymbol[],
  nextCounter: () => number,
): void {
  for (let i = startLine; i < endLine; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#[")) continue;

    const fnMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const blockEnd = Math.min(findBraceBlockEnd(lines, i), endLine);
      const counter = nextCounter();
      const id = `${docId}:n${counter}`;
      const sym: CodeSymbol = {
        id,
        name,
        kind: "method",
        signature: trimmed.replace(/\{?\s*$/, "").trim(),
        content: lines.slice(i, blockEnd + 1).join("\n"),
        line_start: i + 1,
        line_end: blockEnd + 1,
        exported: /^pub\b/.test(trimmed),
        children_ids: [],
        parent_id: parentId,
      };
      symbols.push(sym);
      if (parentId) {
        const parent = symbols.find(s => s.id === parentId);
        if (parent) parent.children_ids.push(id);
      }
      i = blockEnd;
    }
  }
}

/**
 * Find the line containing the closing } that matches the first { at or
 * after startLine. Returns startLine if no brace block is found.
 */
function findBraceBlockEnd(lines: string[], startLine: number): number {
  let depth = 0;
  let found = false;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; found = true; }
      if (ch === "}") depth--;
      if (found && depth === 0) return i;
    }
  }
  return startLine;
}
