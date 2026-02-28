/**
 * Go source file parser
 *
 * Handles Go-specific syntax including receiver methods (linked to their struct),
 * interfaces, type aliases, and grouped const/var blocks.
 *
 * Two-pass approach:
 *   Pass 1: collect named type declarations (struct, interface, type alias)
 *           so receiver methods can link back to their parent struct id.
 *   Pass 2: parse functions, methods, and const/var blocks.
 */
import type { CodeSymbol } from "../code-indexer";

/** Supported file extensions for this parser */
export const GO_EXTENSIONS = new Set([".go"]);

/**
 * Parse a Go source file into code symbols.
 *
 * Extracts:
 *  - Struct declarations (kind="class")
 *  - Interface declarations (kind="interface")
 *  - Type aliases (kind="type")
 *  - Receiver methods, linked as children of their struct (kind="method")
 *  - Top-level functions (kind="function")
 *  - Grouped const/var blocks (kind="variable")
 *  - Single const/var declarations (kind="variable")
 */
export function parseGo(source: string, docId: string): CodeSymbol[] {
  const lines = source.split("\n");
  const symbols: CodeSymbol[] = [];
  let counter = 0;

  // ── Pass 1: collect named type declarations ──────────────────────
  // Build a map of typeName → id so receiver methods can link to them.
  const typeIds = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // type X struct { ... }  or  type X interface { ... }
    const typeMatch = trimmed.match(/^type\s+(\w+)\s+(struct|interface)\b/);
    if (typeMatch) {
      const name = typeMatch[1];
      const kind: CodeSymbol["kind"] = typeMatch[2] === "struct" ? "class" : "interface";
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
        exported: /^[A-Z]/.test(name),
        children_ids: [],
        parent_id: null,
      });
      i = blockEnd;
      continue;
    }

    // type X SomeOtherType  (type alias — not struct or interface)
    const aliasMatch = trimmed.match(/^type\s+(\w+)\s+(?!struct\b|interface\b)(\S+)/);
    if (aliasMatch) {
      const name = aliasMatch[1];
      counter++;
      const id = `${docId}:n${counter}`;
      typeIds.set(name, id);
      symbols.push({
        id,
        name,
        kind: "type",
        signature: trimmed,
        content: trimmed,
        line_start: i + 1,
        line_end: i + 1,
        exported: /^[A-Z]/.test(name),
        children_ids: [],
        parent_id: null,
      });
      continue;
    }
  }

  // ── Pass 2: functions, methods, and const/var blocks ─────────────

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // Skip type declarations (already processed in pass 1)
    if (/^type\s+\w+/.test(trimmed)) {
      // If the type has a brace block body, skip past it
      if (trimmed.match(/^type\s+\w+\s+(struct|interface)\b/)) {
        i = findBraceBlockEnd(lines, i);
      }
      continue;
    }

    // Skip import blocks
    if (trimmed.startsWith("import")) {
      if (trimmed.includes("(")) {
        while (i < lines.length - 1 && !lines[i].includes(")")) i++;
      }
      continue;
    }

    // Skip package declaration
    if (trimmed.startsWith("package ")) continue;

    // ── func (recv *Type) Method(...) — receiver method ────────────
    const methodMatch = trimmed.match(/^func\s+\(\s*\w+\s+\*?(\w+)\s*\)\s+(\w+)\s*\(/);
    if (methodMatch) {
      const receiverType = methodMatch[1];
      const name = methodMatch[2];
      const blockEnd = findBraceBlockEnd(lines, i);
      const parentId = typeIds.get(receiverType) ?? null;
      counter++;
      const id = `${docId}:n${counter}`;
      symbols.push({
        id,
        name,
        kind: "method",
        signature: trimmed.replace(/\{?\s*$/, "").trim(),
        content: lines.slice(i, blockEnd + 1).join("\n"),
        line_start: i + 1,
        line_end: blockEnd + 1,
        exported: /^[A-Z]/.test(name),
        children_ids: [],
        parent_id: parentId,
      });
      if (parentId) {
        const parent = symbols.find(s => s.id === parentId);
        if (parent) parent.children_ids.push(id);
      }
      i = blockEnd;
      continue;
    }

    // ── func Name(...) — top-level function (no receiver) ──────────
    const funcMatch = trimmed.match(/^func\s+(\w+)\s*\(/);
    if (funcMatch) {
      const name = funcMatch[1];
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
        exported: /^[A-Z]/.test(name),
        children_ids: [],
        parent_id: null,
      });
      i = blockEnd;
      continue;
    }

    // ── const ( ... ) or var ( ... ) — grouped block ───────────────
    const groupMatch = trimmed.match(/^(const|var)\s*\(/);
    if (groupMatch) {
      const kwName = groupMatch[1] === "const" ? "constants" : "variables";
      let end = i;
      while (end < lines.length - 1 && !lines[end].includes(")")) end++;
      counter++;
      symbols.push({
        id: `${docId}:n${counter}`,
        name: kwName,
        kind: "variable",
        signature: trimmed,
        content: lines.slice(i, end + 1).join("\n"),
        line_start: i + 1,
        line_end: end + 1,
        exported: false,
        children_ids: [],
        parent_id: null,
      });
      i = end;
      continue;
    }

    // ── var X / const X — single-line declaration ──────────────────
    const singleMatch = trimmed.match(/^(?:const|var)\s+(\w+)/);
    if (singleMatch) {
      const name = singleMatch[1];
      counter++;
      symbols.push({
        id: `${docId}:n${counter}`,
        name,
        kind: "variable",
        signature: trimmed,
        content: trimmed,
        line_start: i + 1,
        line_end: i + 1,
        exported: /^[A-Z]/.test(name),
        children_ids: [],
        parent_id: null,
      });
    }
  }

  return symbols;
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
