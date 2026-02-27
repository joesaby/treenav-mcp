/**
 * Java source file parser
 *
 * Extracts structural symbols from Java source files using regex-based analysis.
 * Handles Java-specific patterns that the generic parser misses:
 *
 * - Methods without a keyword (access modifier + return type + name + "(")
 * - Annotations captured in signatures (@Override, @Stateless, @EJB)
 * - Constructors (detected when name matches enclosing class name)
 * - Inner classes, interfaces, enums, and records
 * - Generic return types (List<String>, Map<K,V>, Optional<List<?>>)
 * - Abstract methods (interface methods, abstract class methods ending with ;)
 * - Brace-depth tracking to avoid false positives inside method bodies
 */

import type { CodeSymbol } from "../code-indexer";

/** Supported file extensions for this parser */
export const JAVA_EXTENSIONS = new Set([".java"]);

/** Control-flow keywords that appear before ( but are not method declarations */
const JAVA_CONTROL_KEYWORDS = new Set([
  "if", "while", "for", "switch", "catch", "return", "throw",
  "new", "assert", "do", "else", "try", "finally", "synchronized",
  "super", "this", "instanceof",
]);

/**
 * Parse a Java source file into code symbols.
 *
 * Extracts:
 *  - Package + imports (grouped into a single "imports" node)
 *  - Classes, interfaces, enums, records, @interface annotations
 *  - Methods and constructors as children of their enclosing type
 *  - Inner classes as children of their enclosing type
 */
export function parseJava(source: string, docId: string): CodeSymbol[] {
  const lines = source.split("\n");
  const symbols: CodeSymbol[] = [];
  let counter = 0;

  // ── Phase 1: package + imports ────────────────────────────────────

  let importStart = -1;
  let importEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = stripLineComment(lines[i]).trim();
    if (t === "" || t.startsWith("*") || t.startsWith("/*")) continue;
    if (t.startsWith("package ") || t.startsWith("import ")) {
      if (importStart === -1) importStart = i;
      importEnd = i;
    } else if (importStart !== -1 && !t.startsWith("@")) {
      break;
    }
  }

  if (importStart !== -1) {
    counter++;
    symbols.push({
      id: `${docId}:n${counter}`,
      name: "imports",
      kind: "import",
      signature: `${importEnd - importStart + 1} import/package statements`,
      content: lines.slice(importStart, importEnd + 1).join("\n"),
      line_start: importStart + 1,
      line_end: importEnd + 1,
      exported: false,
      children_ids: [],
      parent_id: null,
    });
  }

  // ── Phase 2: top-level type declarations ─────────────────────────

  let pendingAnnotations: string[] = [];
  let pendingAnnotStart = -1;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = stripLineComment(lines[i]).trim();

    // Block comment handling
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      pendingAnnotations = [];
      pendingAnnotStart = -1;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Annotation collection (attached to the type declaration below)
    if (trimmed.startsWith("@")) {
      if (pendingAnnotations.length === 0) pendingAnnotStart = i;
      let annotText = trimmed;
      let opens = countChar(annotText, "(");
      let closes = countChar(annotText, ")");
      while (opens > closes && i < lines.length - 1) {
        i++;
        annotText += " " + stripLineComment(lines[i]).trim();
        opens = countChar(annotText, "(");
        closes = countChar(annotText, ")");
      }
      pendingAnnotations.push(annotText);
      continue;
    }

    // Collect multi-line declaration (lookahead until we see { or ;)
    let declText = trimmed;
    for (let j = i + 1; !declText.includes("{") && !declText.includes(";") && j < i + 12 && j < lines.length; j++) {
      declText += " " + stripLineComment(lines[j]).trim();
    }
    declText = declText.replace(/\s+/g, " ").trim();

    // Detect type keyword: class / interface / enum / record / @interface
    const typeKwMatch = declText.match(/\b(class|interface|enum|record|@interface)\s+(\w+)/);
    if (typeKwMatch) {
      const typeKw = typeKwMatch[1];
      const name = typeKwMatch[2];
      const kind: CodeSymbol["kind"] =
        typeKw === "enum" ? "enum"
        : typeKw === "interface" || typeKw === "@interface" ? "interface"
        : "class";

      const blockEnd = findJavaBlockEnd(lines, i);
      // Find the line containing the opening { (may be past i for multi-line declarations)
      const openBraceLine = findOpenBraceLine(lines, i, blockEnd);
      counter++;
      const typeId = `${docId}:n${counter}`;
      const childIds: string[] = [];
      const annotLineStart = pendingAnnotStart !== -1 ? pendingAnnotStart : i;
      const sig = joinSignature(pendingAnnotations, declText.replace(/\s*\{.*$/, "").trim());

      // Parse members starting after { and stopping before the closing }
      const members = parseJavaMembers(lines, openBraceLine + 1, blockEnd - 1, docId, typeId, counter, name);
      counter += members.length;
      for (const m of members) childIds.push(m.id);

      symbols.push({
        id: typeId,
        name,
        kind,
        signature: sig.slice(0, 400),
        content: lines.slice(annotLineStart, blockEnd + 1).join("\n"),
        line_start: annotLineStart + 1,
        line_end: blockEnd + 1,
        exported: declText.includes("public"),
        children_ids: childIds,
        parent_id: null,
      });
      symbols.push(...members);
      pendingAnnotations = [];
      pendingAnnotStart = -1;
      i = blockEnd;
      continue;
    }

    // Not a type declaration — clear annotations
    pendingAnnotations = [];
    pendingAnnotStart = -1;
  }

  return symbols;
}

// ── Class body member parsing ─────────────────────────────────────────

/**
 * Parse a class body for methods, constructors, and inner type declarations.
 *
 * Uses brace-depth tracking: once we enter a method body (depth > 0), all
 * lines are skipped until we exit it. This prevents expressions like
 * `eventPropagator.propagate(...)` inside method bodies from being detected
 * as method declarations.
 */
function parseJavaMembers(
  lines: string[],
  startLine: number,
  endLine: number,
  docId: string,
  parentId: string,
  baseCounter: number,
  className: string,
): CodeSymbol[] {
  const members: CodeSymbol[] = [];
  let counter = baseCounter;
  let braceDepth = 0;
  let inBlockComment = false;
  let pendingAnnotations: string[] = [];
  let pendingAnnotStart = -1;

  for (let i = startLine; i <= endLine; i++) {
    const trimmed = stripLineComment(lines[i]).trim();

    // Block comment handling
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Inside a method body or anonymous class — just track braces, skip
    if (braceDepth > 0) {
      for (const ch of trimmed) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      continue;
    }

    // ── At class body level (braceDepth === 0) ────────────────────

    // Annotation collection
    if (trimmed.startsWith("@")) {
      if (pendingAnnotations.length === 0) pendingAnnotStart = i;
      let annotText = trimmed;
      let opens = countChar(annotText, "(");
      let closes = countChar(annotText, ")");
      while (opens > closes && i < endLine) {
        i++;
        annotText += " " + stripLineComment(lines[i]).trim();
        opens = countChar(annotText, "(");
        closes = countChar(annotText, ")");
      }
      pendingAnnotations.push(annotText);
      continue;
    }

    // Inner type declaration (class / interface / enum / record inside a class)
    const innerTypeMatch = trimmed.match(/\b(class|interface|enum|record|@interface)\s+(\w+)/);
    if (innerTypeMatch) {
      const typeKw = innerTypeMatch[1];
      const innerName = innerTypeMatch[2];
      const kind: CodeSymbol["kind"] =
        typeKw === "enum" ? "enum"
        : typeKw === "interface" || typeKw === "@interface" ? "interface"
        : "class";
      const blockEnd = findJavaBlockEnd(lines, i, endLine);
      counter++;
      const innerTypeId = `${docId}:n${counter}`;
      const annotLineStart = pendingAnnotStart !== -1 ? pendingAnnotStart : i;
      const sig = joinSignature(pendingAnnotations, trimmed.replace(/\s*\{.*$/, "").trim());

      members.push({
        id: innerTypeId,
        name: innerName,
        kind,
        signature: sig.slice(0, 400),
        content: lines.slice(annotLineStart, blockEnd + 1).join("\n"),
        line_start: annotLineStart + 1,
        line_end: blockEnd + 1,
        exported: trimmed.includes("public"),
        children_ids: [],
        parent_id: parentId,
      });
      pendingAnnotations = [];
      pendingAnnotStart = -1;
      i = blockEnd; // skip past the entire inner type body
      continue;
    }

    // Method or constructor detection
    const methodName = detectJavaMethod(trimmed, className);
    if (methodName !== null) {
      const methodEnd = findJavaMethodEnd(lines, i, endLine);
      counter++;
      const annotLineStart = pendingAnnotStart !== -1 ? pendingAnnotStart : i;
      const sigDecl = buildJavaMethodSig(lines, i, Math.min(i + 6, methodEnd));
      const sig = joinSignature(pendingAnnotations, sigDecl);

      members.push({
        id: `${docId}:n${counter}`,
        name: methodName,
        kind: "method",
        signature: sig.slice(0, 400),
        content: lines.slice(annotLineStart, methodEnd + 1).join("\n"),
        line_start: annotLineStart + 1,
        line_end: methodEnd + 1,
        exported: trimmed.includes("public"),
        children_ids: [],
        parent_id: parentId,
      });
      pendingAnnotations = [];
      pendingAnnotStart = -1;
      i = methodEnd;
      continue;
    }

    // Unrecognized line (field, enum constant, static initializer, etc.)
    // Track braces so we can skip over any embedded blocks
    for (const ch of trimmed) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }
    pendingAnnotations = [];
    pendingAnnotStart = -1;
  }

  return members;
}

// ── Method detection ──────────────────────────────────────────────────

/**
 * Detect if a trimmed line is the start of a Java method or constructor
 * declaration. Returns the method name on success, null otherwise.
 *
 * A method declaration has the form:
 *   [modifiers]* [generic-params]? [return-type] name(
 *
 * Key discriminators vs. other patterns:
 *  - Must contain "("
 *  - No "=" before "(" (guards against field initializers: `Foo f = new Foo()`)
 *  - No "." before the method name (guards against method-call chains)
 *  - Method name is not a control-flow keyword
 *  - Either a return type appears before the name, or name == className (constructor)
 */
function detectJavaMethod(line: string, className: string): string | null {
  const parenIdx = line.indexOf("(");
  if (parenIdx === -1) return null;

  const beforeParen = line.slice(0, parenIdx).trim();

  // Field initializer guard: `private Foo f = new Foo()` has = before (
  if (beforeParen.includes("=")) return null;

  // Last identifier before ( = method/constructor name
  const nameMatch = beforeParen.match(/(\w+)\s*$/);
  if (!nameMatch) return null;
  const name = nameMatch[1];

  // Not a control-flow keyword
  if (JAVA_CONTROL_KEYWORDS.has(name)) return null;

  const beforeName = beforeParen.slice(0, -nameMatch[0].length).trim();

  // Method-call chain guard: `obj.method(` has "." before name
  if (beforeName.endsWith(".") || beforeName.includes(".")) return null;

  // Operator/expression guard
  if (/^[=.(,+\-*\/&|^!~]/.test(beforeName)) return null;

  // Constructor: name matches the enclosing class, preceded only by access modifiers
  if (name === className) return name;

  // Regular method: must have at least a return type before the name
  if (beforeName === "") return null;

  return name;
}

// ── Block / method boundary finding ──────────────────────────────────

/**
 * Find the first line at or after startLine that contains a { character.
 * Used to locate the opening brace of a type body after a possibly
 * multi-line declaration.
 */
function findOpenBraceLine(lines: string[], startLine: number, maxLine: number): number {
  for (let i = startLine; i <= maxLine; i++) {
    if (lines[i].includes("{")) return i;
  }
  return startLine;
}

/**
 * Find the line containing the closing } that matches the first { at or
 * after startLine. Respects an optional maxLine upper bound.
 */
function findJavaBlockEnd(lines: string[], startLine: number, maxLine = lines.length - 1): number {
  let depth = 0;
  let foundOpen = false;
  for (let i = startLine; i <= maxLine; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; foundOpen = true; }
      if (ch === "}") depth--;
      if (foundOpen && depth === 0) return i;
    }
  }
  return maxLine;
}

/**
 * Find the end of a method: either the closing } of its body or the trailing
 * ; for abstract methods / interface method signatures.
 */
function findJavaMethodEnd(lines: string[], startLine: number, maxLine: number): number {
  let depth = 0;
  let foundOpen = false;
  for (let i = startLine; i <= maxLine; i++) {
    const t = stripLineComment(lines[i]);
    for (const ch of t) {
      if (ch === "{") { depth++; foundOpen = true; }
      if (ch === "}") depth--;
      if (foundOpen && depth === 0) return i;
    }
    // Abstract / interface method: declaration ends with ;, no body
    if (!foundOpen && t.trim().endsWith(";")) return i;
  }
  return maxLine;
}

// ── Signature helpers ─────────────────────────────────────────────────

/**
 * Collect lines from startLine until we hit { or ; to build a clean
 * method signature string.
 */
function buildJavaMethodSig(lines: string[], startLine: number, maxLine: number): string {
  const parts: string[] = [];
  for (let i = startLine; i <= maxLine; i++) {
    const t = stripLineComment(lines[i]).trim();
    parts.push(t);
    if (t.includes("{") || t.includes(";")) break;
  }
  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s*\{.*$/, "")  // remove trailing { and anything after
    .trim();
}

/**
 * Combine annotation lines with a declaration string into a single signature.
 */
function joinSignature(annotations: string[], decl: string): string {
  return annotations.length > 0 ? [...annotations, decl].join("\n") : decl;
}

// ── Utilities ─────────────────────────────────────────────────────────

/** Strip // end-of-line comments (does not handle // inside string literals). */
function stripLineComment(line: string): string {
  const idx = line.indexOf("//");
  return idx >= 0 ? line.slice(0, idx) : line;
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}
