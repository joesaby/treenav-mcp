# Search Quality Expansion — Multiple Repo Types & Languages

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand search quality test coverage to include 3 new doc repo types (frontend, infrastructure, data science), 3 new code languages (C++, C#, Ruby), Go receiver-method → struct linking, Rust `impl`-block linking, and per-language/per-type NDCG tracking.

**Architecture:** The existing `tests/search-quality.test.ts` framework (corpus files + QRels + metrics) is extended additively. New fixture files go in `tests/fixtures/search-quality/{md,code}/`. New parsers (`src/parsers/go.ts`, `src/parsers/rust.ts`) register in `src/code-indexer.ts` before the generic fallback. All new tests follow the established test structure.

**Tech Stack:** Bun test runner, TypeScript, existing `DocumentStore` + `indexCollection` + `indexCodeCollection` APIs. No new dependencies.

---

## Current State (Do Not Modify)

- `tests/fixtures/search-quality/md/` — 12 markdown files (auth, api, architecture, runbooks, guides)
- `tests/fixtures/search-quality/code/` — 5 files: `AuthService.java`, `oauth_client.py`, `router.ts`, `cluster.go`, `config.rs`
- `tests/fixtures/search-quality-qrels.ts` — 40 QRels, 65 tests passing
- Parsers: dedicated for TypeScript, Python, Java; generic fallback for Go/Rust/C++/C#/Ruby

---

## Task 1: Go dedicated parser — receiver method → struct linking

**Problem:** `cluster.go` method `func (cm *ClusterManager) Connect(...)` is indexed as a standalone function, NOT as a child of `ClusterManager`. Navigation tests can't verify `get_tree` returns Connect as a member.

**Files:**
- Create: `src/parsers/go.ts`
- Modify: `src/code-indexer.ts` (register before generic)
- Test: `tests/parsers.test.ts` (add Go section)

**Step 1: Write the failing tests for Go parser**

Add to `tests/parsers.test.ts`:

```typescript
import { parseGo } from "../src/parsers/go";

describe("parseGo", () => {
  const GO_SAMPLE = `
package cluster

import (
  "context"
  "sync"
)

type NodeState string

const (
  StateConnected NodeState = "connected"
  StateOffline   NodeState = "offline"
)

type ClusterInterface interface {
  Connect(ctx context.Context, address string) error
  Disconnect(address string) error
}

type ClusterManager struct {
  mu    sync.RWMutex
  nodes map[string]NodeState
}

func NewClusterManager() *ClusterManager {
  return &ClusterManager{nodes: make(map[string]NodeState)}
}

func (cm *ClusterManager) Connect(ctx context.Context, address string) error {
  cm.mu.Lock()
  defer cm.mu.Unlock()
  cm.nodes[address] = StateConnected
  return nil
}

func (cm *ClusterManager) Disconnect(address string) error {
  cm.mu.Lock()
  defer cm.mu.Unlock()
  delete(cm.nodes, address)
  return nil
}

func (cm *ClusterManager) activeNodes() []string {
  return nil
}
`.trim();

  test("extracts struct", () => {
    const symbols = parseGo(GO_SAMPLE, "cluster.go");
    const cluster = symbols.find(s => s.name === "ClusterManager");
    expect(cluster).toBeDefined();
    expect(cluster!.kind).toBe("class");
  });

  test("extracts interface", () => {
    const symbols = parseGo(GO_SAMPLE, "cluster.go");
    const iface = symbols.find(s => s.name === "ClusterInterface");
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe("interface");
  });

  test("receiver methods become children of their struct", () => {
    const symbols = parseGo(GO_SAMPLE, "cluster.go");
    const cluster = symbols.find(s => s.name === "ClusterManager")!;
    const connect = symbols.find(s => s.name === "Connect")!;
    const disconnect = symbols.find(s => s.name === "Disconnect")!;
    // Receiver methods should be children of their struct
    expect(connect.parent_id).toBe(cluster.id);
    expect(disconnect.parent_id).toBe(cluster.id);
    expect(cluster.children_ids).toContain(connect.id);
    expect(cluster.children_ids).toContain(disconnect.id);
  });

  test("unexported receiver method is a child but marked unexported", () => {
    const symbols = parseGo(GO_SAMPLE, "cluster.go");
    const active = symbols.find(s => s.name === "activeNodes")!;
    expect(active.parent_id).not.toBeNull();
    expect(active.exported).toBe(false);
  });

  test("non-receiver function is top-level (no parent)", () => {
    const symbols = parseGo(GO_SAMPLE, "cluster.go");
    const ctor = symbols.find(s => s.name === "NewClusterManager")!;
    expect(ctor.parent_id).toBeNull();
    expect(ctor.kind).toBe("function");
  });

  test("extracts const block", () => {
    const symbols = parseGo(GO_SAMPLE, "cluster.go");
    const nodeState = symbols.find(s => s.name === "NodeState");
    expect(nodeState).toBeDefined();
    expect(nodeState!.kind).toBe("type");
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
bun test tests/parsers.test.ts --filter "parseGo" 2>&1 | grep -E "(PASS|FAIL|Error)"
```
Expected: FAIL — `Cannot find module '../src/parsers/go'`

**Step 3: Implement `src/parsers/go.ts`**

```typescript
/**
 * Go source file parser
 *
 * Handles Go-specific syntax:
 * - `type Name struct { ... }` → kind="class"
 * - `type Name interface { ... }` → kind="interface"
 * - `type Name SomeThing` / `type Name = SomeThing` → kind="type"
 * - `func (recv *Type) Method(...)` → kind="method", parent_id=Type.id
 * - `func FuncName(...)` → kind="function", parent_id=null
 * - `const ( ... )` / `var ( ... )` grouped → kind="variable"
 * - Exported = uppercase first char of name
 */
import type { CodeSymbol } from "../code-indexer";

export const GO_EXTENSIONS = new Set([".go"]);

export function parseGo(source: string, docId: string): CodeSymbol[] {
  const lines = source.split("\n");
  const symbols: CodeSymbol[] = [];
  let counter = 0;

  // First pass: collect all struct/interface type declarations
  // Maps type name → symbol id (so receiver methods can link to their parent)
  const typeIds = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;

    // --- type X struct / type X interface / type X = Y ---
    const typeMatch = trimmed.match(/^type\s+(\w+)\s+(struct|interface|=?\s*\w)/);
    if (typeMatch) {
      const name = typeMatch[1];
      const kind = typeMatch[2].trim().startsWith("struct") ? "class"
        : typeMatch[2].trim().startsWith("interface") ? "interface"
        : "type";

      const blockEnd = (kind === "class" || kind === "interface")
        ? findBraceBlockEnd(lines, i)
        : i;

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
  }

  // Second pass: functions and methods (needs typeIds to be populated)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;

    // Skip type declarations (already processed)
    if (trimmed.match(/^type\s+\w+/)) {
      const blockEnd = trimmed.includes("{") ? findBraceBlockEnd(lines, i) : i;
      i = blockEnd;
      continue;
    }

    // --- func (recv ReceiverType) MethodName(...) / func (recv *ReceiverType) MethodName(...) ---
    const methodMatch = trimmed.match(/^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(/);
    if (methodMatch) {
      const receiverType = methodMatch[2];
      const name = methodMatch[3];
      const blockEnd = findBraceBlockEnd(lines, i);
      const parentId = typeIds.get(receiverType) ?? null;

      counter++;
      const id = `${docId}:n${counter}`;
      const sym: CodeSymbol = {
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
      };
      symbols.push(sym);

      // Link parent's children_ids
      if (parentId) {
        const parent = symbols.find(s => s.id === parentId);
        if (parent) parent.children_ids.push(id);
      }
      i = blockEnd;
      continue;
    }

    // --- func FuncName(...) — top-level, no receiver ---
    const funcMatch = trimmed.match(/^func\s+(\w+)\s*(?:<[^>]+>)?\s*\(/);
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

    // --- const ( ... ) / var ( ... ) grouped blocks ---
    const groupMatch = trimmed.match(/^(?:const|var)\s*\(/);
    if (groupMatch) {
      let end = i;
      while (end < lines.length - 1 && !lines[end].includes(")")) end++;
      counter++;
      symbols.push({
        id: `${docId}:n${counter}`,
        name: trimmed.startsWith("const") ? "constants" : "variables",
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

    // --- const X / var X single-line ---
    const singleConst = trimmed.match(/^(?:const|var)\s+(\w+)/);
    if (singleConst) {
      const name = singleConst[1];
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
      continue;
    }
  }

  return symbols;
}

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
```

**Step 4: Run tests to confirm they pass**

```bash
bun test tests/parsers.test.ts --filter "parseGo" 2>&1 | grep -E "(PASS|FAIL|pass|fail)"
```
Expected: All parseGo tests PASS

**Step 5: Register Go parser in `src/code-indexer.ts`**

In `src/code-indexer.ts`, after the Java import, add:
```typescript
import { parseGo, GO_EXTENSIONS } from "./parsers/go";
```

In the `CODE_EXTENSIONS` set:
```typescript
export const CODE_EXTENSIONS = new Set([
  ...TYPESCRIPT_EXTENSIONS,
  ...PYTHON_EXTENSIONS,
  ...JAVA_EXTENSIONS,
  ...GO_EXTENSIONS,           // ← add this line
  ...GENERIC_EXTENSIONS,
]);
```

Remove `.go` from `GENERIC_EXTENSIONS` in `src/parsers/generic.ts`:
```typescript
export const GENERIC_EXTENSIONS = new Set([
  // ".go",   ← remove this
  ".rs", ".kt", ".scala",
  ...
]);
```

In the parser dispatch function (find the `parseFile` / dispatch switch), add before the generic fallback:
```typescript
if (GO_EXTENSIONS.has(ext)) return parseGo(source, docId);
```

**Step 6: Run the full test suite to confirm no regressions**

```bash
bun test 2>&1 | grep -E "(pass|fail|PASS|FAIL)"
```
Expected: All tests still pass (cluster.go's Connect/Disconnect are now children of ClusterManager)

**Step 7: Commit**

```bash
git add src/parsers/go.ts src/code-indexer.ts src/parsers/generic.ts tests/parsers.test.ts
git commit -m "feat: add dedicated Go parser with receiver-method → struct linking"
```

---

## Task 2: Rust dedicated parser — `impl` block linking

**Problem:** Idiomatic Rust uses `impl Config { fn from_env(...) }` to associate methods with a struct. The generic parser ignores `impl` blocks entirely — methods inside impl blocks are invisible. The current `config.rs` uses top-level functions (non-idiomatic) as a workaround.

**Files:**
- Create: `src/parsers/rust.ts`
- Modify: `src/code-indexer.ts` (register before generic)
- Modify: `tests/fixtures/search-quality/code/config.rs` (replace with idiomatic Rust)
- Test: `tests/parsers.test.ts` (add Rust section)

**Step 1: Write failing tests for Rust parser**

Add to `tests/parsers.test.ts`:

```typescript
import { parseRust } from "../src/parsers/rust";

describe("parseRust", () => {
  const RUST_SAMPLE = `
use std::env;

pub const DEFAULT_TIMEOUT: u64 = 5000;

pub enum ConfigError {
    MissingVar(String),
    InvalidValue(String),
}

pub struct Config {
    pub api_key: String,
    pub timeout_ms: u64,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let api_key = env::var("API_KEY")
            .map_err(|_| ConfigError::MissingVar("API_KEY".to_string()))?;
        Ok(Config { api_key, timeout_ms: DEFAULT_TIMEOUT })
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.api_key.is_empty() {
            return Err(ConfigError::InvalidValue("empty key".to_string()));
        }
        Ok(())
    }

    fn internal_helper(&self) -> bool {
        !self.api_key.is_empty()
    }
}

pub trait Configurable {
    fn configure(&self) -> Result<(), ConfigError>;
}

impl Configurable for Config {
    fn configure(&self) -> Result<(), ConfigError> {
        self.validate()
    }
}
`.trim();

  test("extracts struct", () => {
    const symbols = parseRust(RUST_SAMPLE, "config.rs");
    const config = symbols.find(s => s.name === "Config");
    expect(config).toBeDefined();
    expect(config!.kind).toBe("class");
  });

  test("extracts enum", () => {
    const symbols = parseRust(RUST_SAMPLE, "config.rs");
    const err = symbols.find(s => s.name === "ConfigError");
    expect(err).toBeDefined();
    expect(err!.kind).toBe("enum");
  });

  test("extracts trait", () => {
    const symbols = parseRust(RUST_SAMPLE, "config.rs");
    const trait_ = symbols.find(s => s.name === "Configurable");
    expect(trait_).toBeDefined();
    expect(trait_!.kind).toBe("interface");
  });

  test("impl methods become children of their struct", () => {
    const symbols = parseRust(RUST_SAMPLE, "config.rs");
    const config = symbols.find(s => s.name === "Config")!;
    const fromEnv = symbols.find(s => s.name === "from_env")!;
    const validate = symbols.find(s => s.name === "validate")!;
    expect(fromEnv.parent_id).toBe(config.id);
    expect(validate.parent_id).toBe(config.id);
    expect(config.children_ids).toContain(fromEnv.id);
    expect(config.children_ids).toContain(validate.id);
  });

  test("private impl method is a child but marked unexported", () => {
    const symbols = parseRust(RUST_SAMPLE, "config.rs");
    const helper = symbols.find(s => s.name === "internal_helper")!;
    expect(helper.parent_id).not.toBeNull();
    expect(helper.exported).toBe(false);
  });

  test("impl Trait for Type — methods linked to the implementing type", () => {
    const symbols = parseRust(RUST_SAMPLE, "config.rs");
    const configure = symbols.find(s => s.name === "configure")!;
    const config = symbols.find(s => s.name === "Config")!;
    expect(configure.parent_id).toBe(config.id);
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
bun test tests/parsers.test.ts --filter "parseRust" 2>&1 | grep -E "(PASS|FAIL|Error)"
```
Expected: FAIL — `Cannot find module '../src/parsers/rust'`

**Step 3: Implement `src/parsers/rust.ts`**

```typescript
/**
 * Rust source file parser
 *
 * Handles Rust-specific syntax:
 * - `pub struct Name { ... }` → kind="class"
 * - `pub enum Name { ... }` → kind="enum"
 * - `pub trait Name { ... }` → kind="interface"
 * - `impl Name { ... }` → methods become children of Name
 * - `impl Trait for Name { ... }` → methods become children of Name
 * - `pub fn name(...)` at top level → kind="function", no parent
 * - `pub const / pub static` → kind="variable"
 * - `pub type Name = ...` → kind="type"
 * - Exported = has `pub` prefix
 */
import type { CodeSymbol } from "../code-indexer";

export const RUST_EXTENSIONS = new Set([".rs"]);

export function parseRust(source: string, docId: string): CodeSymbol[] {
  const lines = source.split("\n");
  const symbols: CodeSymbol[] = [];
  let counter = 0;

  // First pass: collect named types (struct, enum, trait) → their ids
  const typeIds = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("///")) continue;

    const structMatch = trimmed.match(/^pub\s+struct\s+(\w+)/) || trimmed.match(/^struct\s+(\w+)/);
    const enumMatch   = trimmed.match(/^pub\s+enum\s+(\w+)/)   || trimmed.match(/^enum\s+(\w+)/);
    const traitMatch  = trimmed.match(/^pub\s+trait\s+(\w+)/)  || trimmed.match(/^trait\s+(\w+)/);

    const typeMatch = structMatch || enumMatch || traitMatch;
    if (typeMatch) {
      const name = typeMatch[1];
      const kind = structMatch ? "class" : enumMatch ? "enum" : "interface";
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
        exported: trimmed.startsWith("pub"),
        children_ids: [],
        parent_id: null,
      });
      i = blockEnd;
    }
  }

  // Second pass: impl blocks, top-level functions, consts
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("///")) continue;

    // Skip already-parsed struct/enum/trait
    if (trimmed.match(/^(?:pub\s+)?(?:struct|enum|trait)\s+\w+/)) {
      i = findBraceBlockEnd(lines, i);
      continue;
    }

    // --- impl Trait for Type { ... } OR impl Type { ... } ---
    const implForMatch = trimmed.match(/^impl\s+\w+\s+for\s+(\w+)/);
    const implSelfMatch = !implForMatch && trimmed.match(/^impl(?:<[^>]+>)?\s+(\w+)/);
    const implMatch = implForMatch || implSelfMatch;

    if (implMatch) {
      const typeName = implMatch[1];
      const parentId = typeIds.get(typeName) ?? null;
      const blockEnd = findBraceBlockEnd(lines, i);

      // Parse methods inside impl block
      const methods = parseImplMethods(lines, i + 1, blockEnd, docId, parentId, counter);
      for (const m of methods) {
        counter++;
        m.id = `${docId}:n${counter}`;
        symbols.push(m);
        if (parentId) {
          const parent = symbols.find(s => s.id === parentId);
          if (parent) parent.children_ids.push(m.id);
        }
      }
      i = blockEnd;
      continue;
    }

    // --- Top-level pub fn / fn ---
    const fnMatch = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
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
        exported: trimmed.startsWith("pub"),
        children_ids: [],
        parent_id: null,
      });
      i = blockEnd;
      continue;
    }

    // --- pub const / pub static / pub type ---
    const constMatch = trimmed.match(/^pub\s+(?:const|static)\s+(\w+)/)
      || trimmed.match(/^(?:const|static)\s+(\w+)/);
    if (constMatch) {
      const name = constMatch[1];
      counter++;
      symbols.push({
        id: `${docId}:n${counter}`,
        name,
        kind: "variable",
        signature: trimmed.replace(/[;]\s*$/, "").trim(),
        content: trimmed,
        line_start: i + 1,
        line_end: i + 1,
        exported: trimmed.startsWith("pub"),
        children_ids: [],
        parent_id: null,
      });
      continue;
    }

    const typeAliasMatch = trimmed.match(/^pub\s+type\s+(\w+)/) || trimmed.match(/^type\s+(\w+)/);
    if (typeAliasMatch) {
      const name = typeAliasMatch[1];
      counter++;
      symbols.push({
        id: `${docId}:n${counter}`,
        name,
        kind: "type",
        signature: trimmed.replace(/[;]\s*$/, "").trim(),
        content: trimmed,
        line_start: i + 1,
        line_end: i + 1,
        exported: trimmed.startsWith("pub"),
        children_ids: [],
        parent_id: null,
      });
    }
  }

  return symbols;
}

function parseImplMethods(
  lines: string[],
  startLine: number,
  endLine: number,
  docId: string,
  parentId: string | null,
  baseCounter: number,
): CodeSymbol[] {
  const methods: CodeSymbol[] = [];
  for (let i = startLine; i < endLine; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;
    const fnMatch = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const blockEnd = Math.min(findBraceBlockEnd(lines, i), endLine);
      methods.push({
        id: "",  // assigned by caller
        name,
        kind: "method",
        signature: trimmed.replace(/\{?\s*$/, "").trim(),
        content: lines.slice(i, blockEnd + 1).join("\n"),
        line_start: i + 1,
        line_end: blockEnd + 1,
        exported: trimmed.startsWith("pub"),
        children_ids: [],
        parent_id: parentId,
      });
      i = blockEnd;
    }
  }
  return methods;
}

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
```

**Step 4: Run tests to confirm they pass**

```bash
bun test tests/parsers.test.ts --filter "parseRust" 2>&1 | grep -E "(pass|fail)"
```
Expected: All parseRust tests PASS

**Step 5: Register Rust parser in `src/code-indexer.ts`**

```typescript
import { parseRust, RUST_EXTENSIONS } from "./parsers/rust";
// In CODE_EXTENSIONS: add ...RUST_EXTENSIONS
// In dispatch: if (RUST_EXTENSIONS.has(ext)) return parseRust(source, docId);
```

Remove `.rs` from `GENERIC_EXTENSIONS` in `src/parsers/generic.ts`.

**Step 6: Replace `config.rs` with idiomatic impl-block version**

Replace `tests/fixtures/search-quality/code/config.rs` with:

```rust
use std::env;

pub const DEFAULT_TIMEOUT_MS: u64 = 5000;
pub static DEFAULT_LOG_LEVEL: &str = "info";

pub enum ConfigError {
    MissingVar(String),
    InvalidValue(String),
}

pub struct Config {
    pub api_key: String,
    pub base_url: String,
    pub timeout_ms: u64,
    pub log_level: String,
    pub debug: bool,
}

impl Config {
    pub fn from_env() -> Result<Config, ConfigError> {
        let api_key = env::var("API_KEY")
            .map_err(|_| ConfigError::MissingVar("API_KEY".to_string()))?;
        let base_url = env::var("BASE_URL")
            .unwrap_or_else(|_| "https://api.example.com".to_string());
        let timeout_ms = env::var("TIMEOUT_MS")
            .unwrap_or_else(|_| DEFAULT_TIMEOUT_MS.to_string())
            .parse::<u64>()
            .map_err(|e| ConfigError::InvalidValue(format!("TIMEOUT_MS: {}", e)))?;
        Ok(Config {
            api_key,
            base_url,
            timeout_ms,
            log_level: env::var("LOG_LEVEL").unwrap_or_else(|_| DEFAULT_LOG_LEVEL.to_string()),
            debug: env::var("DEBUG").unwrap_or_default() == "true",
        })
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.api_key.is_empty() {
            return Err(ConfigError::InvalidValue("API_KEY cannot be empty".to_string()));
        }
        if self.timeout_ms == 0 {
            return Err(ConfigError::InvalidValue("TIMEOUT_MS must be > 0".to_string()));
        }
        Ok(())
    }

    fn parse_log_level(level: &str) -> &str {
        match level {
            "debug" | "info" | "warn" | "error" => level,
            _ => DEFAULT_LOG_LEVEL,
        }
    }
}
```

**Step 7: Run full test suite — confirm still passing**

```bash
bun test 2>&1 | grep -E "(pass|fail)"
```
Expected: All tests pass (QRels C6 still finds `from_env` and `validate` via Rust parser now)

**Step 8: Commit**

```bash
git add src/parsers/rust.ts src/code-indexer.ts src/parsers/generic.ts tests/parsers.test.ts tests/fixtures/search-quality/code/config.rs
git commit -m "feat: add dedicated Rust parser with impl-block → struct linking"
```

---

## Task 3: Add navigation test for Go receiver methods

**Problem:** The Go parser now links receiver methods to structs. We need a test that verifies this navigation pattern in the quality test suite.

**Files:**
- Modify: `tests/fixtures/search-quality/code/cluster.go` (add more symbols for navigation)
- Modify: `tests/search-quality.test.ts` (add N9 navigation describe block)

**Step 1: Update `cluster.go` to expose a richer tree**

Add a `NodeState` type and `NewClusterManager` constructor to give the tree more shape:

```go
package cluster

import (
	"context"
	"fmt"
	"sync"
)

type NodeState string

const (
	StateConnected NodeState = "connected"
	StateOffline   NodeState = "offline"
)

var ErrNotConnected = fmt.Errorf("cluster node is not connected")

// ClusterInterface defines the contract for cluster node management.
type ClusterInterface interface {
	Connect(ctx context.Context, address string, port int) error
	Disconnect(address string) error
	GetNode(address string) (*NodeInfo, error)
}

// NodeInfo holds metadata about a cluster node.
type NodeInfo struct {
	Address string
	Port    int
	State   NodeState
}

// ClusterManager implements ClusterInterface.
type ClusterManager struct {
	mu    sync.RWMutex
	nodes map[string]*NodeInfo
}

// NewClusterManager creates an empty cluster manager.
func NewClusterManager() *ClusterManager {
	return &ClusterManager{
		nodes: make(map[string]*NodeInfo),
	}
}

// Connect registers a node as connected.
func (cm *ClusterManager) Connect(ctx context.Context, address string, port int) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.nodes[address] = &NodeInfo{Address: address, Port: port, State: StateConnected}
	return nil
}

// Disconnect removes a node from the cluster.
func (cm *ClusterManager) Disconnect(address string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if _, ok := cm.nodes[address]; !ok {
		return ErrNotConnected
	}
	delete(cm.nodes, address)
	return nil
}

// GetNode retrieves node info by address.
func (cm *ClusterManager) GetNode(address string) (*NodeInfo, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	node, ok := cm.nodes[address]
	if !ok {
		return nil, ErrNotConnected
	}
	return node, nil
}

func (cm *ClusterManager) activeNodes() []*NodeInfo {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	result := make([]*NodeInfo, 0, len(cm.nodes))
	for _, node := range cm.nodes {
		if node.State == StateConnected {
			result = append(result, node)
		}
	}
	return result
}
```

**Step 2: Add N9 navigation test to `tests/search-quality.test.ts`**

Append at the end of the tree navigation section:

```typescript
describe("Tree Navigation — N9: Go struct → receiver methods", () => {
  test("search 'ClusterManager' surfaces cluster.go", () => {
    const results = store.searchDocuments("ClusterManager", { limit: 5, collection: "code" });
    const docId = findDocId("cluster");
    expect(results.some(r => r.doc_id === docId)).toBe(true);
  });

  test("get_tree returns ClusterManager with receiver methods as children", () => {
    const docId = findDocId("cluster")!;
    const tree = store.getTree(docId)!;
    const clusterNode = tree.nodes.find(n => n.title.includes("ClusterManager") && n.title.includes("class"));
    expect(clusterNode).toBeDefined();
    // Connect, Disconnect, GetNode should be children
    const childTitles = tree.nodes
      .filter(n => clusterNode!.children.includes(n.node_id))
      .map(n => n.title);
    expect(childTitles.some(t => t.includes("Connect"))).toBe(true);
    expect(childTitles.some(t => t.includes("Disconnect"))).toBe(true);
    expect(childTitles.some(t => t.includes("GetNode"))).toBe(true);
  });

  test("Connect method has correct parent linking", () => {
    const docId = findDocId("cluster")!;
    const clusterNodeId = findNodeId(docId, "ClusterManager");
    const connectNodeId = findNodeId(docId, "Connect");
    expect(clusterNodeId).not.toBeNull();
    expect(connectNodeId).not.toBeNull();
    const tree = store.getTree(docId)!;
    const clusterNode = tree.nodes.find(n => n.node_id === clusterNodeId)!;
    expect(clusterNode.children).toContain(connectNodeId);
  });
});

describe("Tree Navigation — N10: Rust struct → impl methods", () => {
  test("search 'Config from_env' surfaces config.rs", () => {
    const results = store.searchDocuments("Config from_env", { limit: 5, collection: "code" });
    const docId = findDocId("config");
    expect(results.some(r => r.doc_id === docId)).toBe(true);
  });

  test("get_tree returns Config with from_env and validate as children", () => {
    const docId = findDocId("config")!;
    const tree = store.getTree(docId)!;
    const configNode = tree.nodes.find(n => n.title.includes("Config") && n.title.includes("class"));
    expect(configNode).toBeDefined();
    const childTitles = tree.nodes
      .filter(n => configNode!.children.includes(n.node_id))
      .map(n => n.title);
    expect(childTitles.some(t => t.includes("from_env"))).toBe(true);
    expect(childTitles.some(t => t.includes("validate"))).toBe(true);
  });

  test("from_env method node returns expected content", () => {
    const docId = findDocId("config")!;
    const nodeId = findNodeId(docId, "from_env")!;
    expect(nodeId).not.toBeNull();
    const result = store.getNodeContent(docId, [nodeId]);
    expect(result).not.toBeNull();
    expect(result!.nodes[0].content).toContain("from_env");
    expect(result!.nodes[0].content).toContain("API_KEY");
  });
});
```

**Step 3: Run quality tests and confirm new navigation tests pass**

```bash
bun test tests/search-quality.test.ts 2>&1 | grep -E "(N9|N10|pass|fail)"
```
Expected: All tests pass including N9 and N10

**Step 4: Commit**

```bash
git add tests/fixtures/search-quality/code/cluster.go tests/search-quality.test.ts
git commit -m "test: add Go and Rust navigation tests (N9, N10) for receiver/impl linking"
```

---

## Task 4: Add C++ code fixture with quality tests

**Problem:** C++ is a dominant language for systems, game engines, and embedded software. No C++ fixture exists in the quality test corpus.

**Files:**
- Create: `tests/fixtures/search-quality/code/connection_pool.cpp`
- Modify: `tests/search-quality.test.ts` (update corpus sanity count, add C++ QRels)
- Modify: `tests/fixtures/search-quality-qrels.ts` (add C++ code-symbol QRels)

**Step 1: Write the failing corpus sanity test update**

In `tests/search-quality.test.ts`, update:
```typescript
test("5 code files indexed", () => {   // change to:
test("8 code files indexed", () => {   // after all new fixtures (C++, C#, Ruby)
  const listing = store.listDocuments({ collection: "code", limit: 100 });
  expect(listing.total).toBe(8);
});
```

Run to confirm it fails:
```bash
bun test tests/search-quality.test.ts --filter "code files indexed" 2>&1 | grep -E "(PASS|FAIL)"
```
Expected: FAIL (still 5 files)

**Step 2: Create `tests/fixtures/search-quality/code/connection_pool.cpp`**

```cpp
#pragma once
#include <string>
#include <vector>
#include <mutex>
#include <memory>
#include <stdexcept>

/**
 * ConnectionPool manages a fixed-size pool of reusable database connections.
 * Thread-safe acquire/release cycle with configurable pool size and timeout.
 */
class Connection {
public:
    explicit Connection(const std::string& dsn);
    ~Connection();

    bool isAlive() const;
    void execute(const std::string& query);
    void close();

private:
    std::string dsn_;
    bool connected_ = false;
};

class ConnectionPoolError : public std::runtime_error {
public:
    explicit ConnectionPoolError(const std::string& msg)
        : std::runtime_error(msg) {}
};

class ConnectionPool {
public:
    /**
     * Create a pool with max_size connections to the given DSN.
     * Throws ConnectionPoolError if initial connections fail.
     */
    explicit ConnectionPool(const std::string& dsn, size_t max_size = 10);
    ~ConnectionPool();

    // Non-copyable
    ConnectionPool(const ConnectionPool&) = delete;
    ConnectionPool& operator=(const ConnectionPool&) = delete;

    /**
     * Acquire a connection from the pool. Blocks until one is available
     * or timeout_ms elapses (0 = no timeout).
     */
    Connection* acquire(int timeout_ms = 0);

    /**
     * Release a connection back to the pool. Must be called exactly once
     * for each acquire().
     */
    void release(Connection* conn);

    /** Number of connections currently available in the pool. */
    size_t available() const;

    /** Total pool capacity. */
    size_t capacity() const { return max_size_; }

private:
    std::string dsn_;
    size_t max_size_;
    mutable std::mutex mutex_;
    std::vector<std::unique_ptr<Connection>> pool_;
    std::vector<Connection*> available_;
};

// ── Implementation ────────────────────────────────────────────────────

Connection::Connection(const std::string& dsn) : dsn_(dsn), connected_(true) {}

Connection::~Connection() { close(); }

bool Connection::isAlive() const { return connected_; }

void Connection::execute(const std::string& query) {
    if (!connected_) throw ConnectionPoolError("Connection is closed");
    // execute query...
}

void Connection::close() { connected_ = false; }

ConnectionPool::ConnectionPool(const std::string& dsn, size_t max_size)
    : dsn_(dsn), max_size_(max_size) {
    pool_.reserve(max_size);
    for (size_t i = 0; i < max_size; ++i) {
        auto conn = std::make_unique<Connection>(dsn);
        available_.push_back(conn.get());
        pool_.push_back(std::move(conn));
    }
}

ConnectionPool::~ConnectionPool() = default;

Connection* ConnectionPool::acquire(int timeout_ms) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (available_.empty()) {
        if (timeout_ms == 0) throw ConnectionPoolError("Pool exhausted");
        // simplified: just throw on timeout
        throw ConnectionPoolError("acquire timed out");
    }
    Connection* conn = available_.back();
    available_.pop_back();
    return conn;
}

void ConnectionPool::release(Connection* conn) {
    std::unique_lock<std::mutex> lock(mutex_);
    available_.push_back(conn);
}

size_t ConnectionPool::available() const {
    std::unique_lock<std::mutex> lock(mutex_);
    return available_.size();
}
```

**Step 3: Add C++ QRels to `tests/fixtures/search-quality-qrels.ts`**

Append to the `QRELS` array:

```typescript
// ── C++ code symbols (3) ───────────────────────────────────────────────
{
  id: "CPP1",
  query: "ConnectionPool acquire release",
  category: "code-symbol",
  relevant: [
    { docTitle: "connection_pool", nodeTitle: "acquire", relevance: 3 },
    { docTitle: "connection_pool", nodeTitle: "release", relevance: 2 },
    { docTitle: "connection_pool", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "connection_pool", nodeTitle: "acquire", k: 5 },
},
{
  id: "CPP2",
  query: "ConnectionPoolError exception",
  category: "code-symbol",
  relevant: [
    { docTitle: "connection_pool", nodeTitle: "ConnectionPoolError", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "connection_pool", nodeTitle: "ConnectionPoolError", k: 5 },
},
{
  id: "CPP3",
  query: "database connection pool thread safe",
  category: "multi-term",
  relevant: [
    { docTitle: "connection_pool", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "connection_pool", k: 3 },
},
```

**Step 4: Update corpus sanity test count in `tests/search-quality.test.ts`**

After all three new fixtures are added (C++, C#, Ruby — from Tasks 4–6), the count becomes 8.
For now, temporarily change the assertion to 6 (just C++ added):
```typescript
test("6 code files indexed", () => {
  const listing = store.listDocuments({ collection: "code", limit: 100 });
  expect(listing.total).toBe(6);
});
```

Also update the language facets test to include `cpp`:
```typescript
expect(langs.has("cpp")).toBe(true);
```

**Step 5: Run tests to confirm the new QRels and fixture work**

```bash
bun test tests/search-quality.test.ts 2>&1 | grep -E "(CPP|pass|fail)"
```
Expected: CPP1, CPP2, CPP3 pass, overall pass count increases

**Step 6: Commit**

```bash
git add tests/fixtures/search-quality/code/connection_pool.cpp tests/fixtures/search-quality-qrels.ts tests/search-quality.test.ts
git commit -m "test: add C++ connection pool fixture and search quality QRels"
```

---

## Task 5: Add C# code fixture with quality tests

**Problem:** C# is dominant in enterprise software and Unity game dev. No C# fixture exists.

**Files:**
- Create: `tests/fixtures/search-quality/code/UserService.cs`
- Modify: `tests/fixtures/search-quality-qrels.ts` (add C# QRels)
- Modify: `tests/search-quality.test.ts` (update count to 7)

**Step 1: Create `tests/fixtures/search-quality/code/UserService.cs`**

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Example.Services
{
    /// <summary>Interface for user data access operations.</summary>
    public interface IUserRepository
    {
        Task<User?> FindByIdAsync(int id);
        Task<User?> FindByEmailAsync(string email);
        Task<int> CreateAsync(User user);
        Task UpdateAsync(User user);
        Task DeleteAsync(int id);
    }

    /// <summary>User domain model.</summary>
    public class User
    {
        public int Id { get; set; }
        public string Email { get; set; } = string.Empty;
        public string PasswordHash { get; set; } = string.Empty;
        public string Role { get; set; } = "user";
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public bool IsActive { get; set; } = true;
    }

    public class UserNotFoundException : Exception
    {
        public UserNotFoundException(int id)
            : base($"User with id {id} not found") { }
    }

    /// <summary>
    /// Business logic layer for user management.
    /// Wraps IUserRepository and adds validation + authorization.
    /// </summary>
    public class UserService
    {
        private readonly IUserRepository _repository;
        private readonly IPasswordHasher _hasher;

        public UserService(IUserRepository repository, IPasswordHasher hasher)
        {
            _repository = repository;
            _hasher = hasher;
        }

        public async Task<User> GetUserAsync(int id)
        {
            var user = await _repository.FindByIdAsync(id);
            if (user == null) throw new UserNotFoundException(id);
            return user;
        }

        public async Task<User> CreateUserAsync(string email, string password)
        {
            var existing = await _repository.FindByEmailAsync(email);
            if (existing != null)
                throw new InvalidOperationException($"Email {email} already registered");

            var user = new User
            {
                Email = email,
                PasswordHash = _hasher.Hash(password),
            };
            user.Id = await _repository.CreateAsync(user);
            return user;
        }

        public async Task ChangePasswordAsync(int userId, string oldPassword, string newPassword)
        {
            var user = await GetUserAsync(userId);
            if (!_hasher.Verify(oldPassword, user.PasswordHash))
                throw new UnauthorizedAccessException("Invalid current password");
            user.PasswordHash = _hasher.Hash(newPassword);
            await _repository.UpdateAsync(user);
        }

        public async Task DeactivateAsync(int userId)
        {
            var user = await GetUserAsync(userId);
            user.IsActive = false;
            await _repository.UpdateAsync(user);
        }

        private static bool IsValidEmail(string email) =>
            email.Contains('@') && email.Contains('.');
    }

    public interface IPasswordHasher
    {
        string Hash(string password);
        bool Verify(string password, string hash);
    }
}
```

**Step 2: Add C# QRels to `tests/fixtures/search-quality-qrels.ts`**

```typescript
{
  id: "CS1",
  query: "UserService CreateUserAsync",
  category: "code-symbol",
  relevant: [
    { docTitle: "UserService", nodeTitle: "CreateUserAsync", relevance: 3 },
    { docTitle: "UserService", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "UserService", nodeTitle: "CreateUserAsync", k: 5 },
},
{
  id: "CS2",
  query: "IUserRepository FindByEmail",
  category: "code-symbol",
  relevant: [
    { docTitle: "UserService", nodeTitle: "IUserRepository", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "UserService", nodeTitle: "IUserRepository", k: 5 },
},
{
  id: "CS3",
  query: "change password hash verify",
  category: "multi-term",
  relevant: [
    { docTitle: "UserService", nodeTitle: "ChangePasswordAsync", relevance: 3 },
    { docTitle: "UserService", nodeTitle: "IPasswordHasher", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "UserService", nodeTitle: "ChangePasswordAsync", k: 5 },
},
```

**Step 3: Update corpus sanity count in test to 7, add `csharp` to language facets check**

**Step 4: Run tests**

```bash
bun test tests/search-quality.test.ts 2>&1 | grep -E "(CS[1-3]|pass|fail)"
```
Expected: CS1, CS2, CS3 pass

**Step 5: Commit**

```bash
git add tests/fixtures/search-quality/code/UserService.cs tests/fixtures/search-quality-qrels.ts tests/search-quality.test.ts
git commit -m "test: add C# UserService fixture and search quality QRels"
```

---

## Task 6: Add Ruby code fixture with quality tests

**Problem:** Ruby is dominant in web development (Rails). No Ruby fixture exists.

**Files:**
- Create: `tests/fixtures/search-quality/code/order_processor.rb`
- Modify: `tests/fixtures/search-quality-qrels.ts` (add Ruby QRels)
- Modify: `tests/search-quality.test.ts` (update count to 8, add `ruby` to language facets)

**Step 1: Create `tests/fixtures/search-quality/code/order_processor.rb`**

```ruby
# frozen_string_literal: true

# Raised when an order cannot be fulfilled due to insufficient inventory.
class InsufficientInventoryError < StandardError
  def initialize(product_id, requested, available)
    super("Product #{product_id}: requested #{requested}, available #{available}")
    @product_id = product_id
    @requested = requested
    @available = available
  end

  attr_reader :product_id, :requested, :available
end

# Processes customer orders: validates inventory, applies discounts, charges payment.
class OrderProcessor
  DISCOUNT_THRESHOLD = 100.0

  def initialize(inventory_service, payment_gateway, notifier)
    @inventory = inventory_service
    @payment = payment_gateway
    @notifier = notifier
  end

  # Process a complete order. Returns the order receipt or raises on failure.
  def process(order)
    validate_inventory(order)
    total = calculate_total(order)
    charge = @payment.charge(order.customer_id, total, order.currency)
    @inventory.reserve(order.items)
    @notifier.send_confirmation(order.customer_id, charge.transaction_id)
    { transaction_id: charge.transaction_id, total: total }
  end

  # Cancel a previously placed order and issue a refund.
  def cancel(order_id)
    order = find_order(order_id)
    @payment.refund(order.transaction_id)
    @inventory.release(order.items)
    @notifier.send_cancellation(order.customer_id)
    true
  end

  private

  def validate_inventory(order)
    order.items.each do |item|
      available = @inventory.available_quantity(item.product_id)
      if item.quantity > available
        raise InsufficientInventoryError.new(item.product_id, item.quantity, available)
      end
    end
  end

  def calculate_total(order)
    subtotal = order.items.sum { |item| item.price * item.quantity }
    subtotal > DISCOUNT_THRESHOLD ? subtotal * 0.95 : subtotal
  end

  def find_order(order_id)
    # implementation omitted
    raise ArgumentError, "Order #{order_id} not found"
  end
end
```

**Step 2: Add Ruby QRels**

```typescript
{
  id: "RB1",
  query: "OrderProcessor process cancel",
  category: "code-symbol",
  relevant: [
    { docTitle: "order_processor", nodeTitle: "process", relevance: 3 },
    { docTitle: "order_processor", nodeTitle: "cancel", relevance: 2 },
    { docTitle: "order_processor", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "order_processor", nodeTitle: "process", k: 5 },
},
{
  id: "RB2",
  query: "InsufficientInventoryError inventory",
  category: "code-symbol",
  relevant: [
    { docTitle: "order_processor", nodeTitle: "InsufficientInventoryError", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "order_processor", nodeTitle: "InsufficientInventoryError", k: 5 },
},
{
  id: "RB3",
  query: "discount calculate total",
  category: "multi-term",
  relevant: [
    { docTitle: "order_processor", nodeTitle: "calculate_total", relevance: 3 },
  ],
},
```

**Step 3: Update count to 8 in corpus sanity test, add `ruby` to language facets check**

**Step 4: Run tests**

```bash
bun test tests/search-quality.test.ts 2>&1 | grep -E "(RB[1-3]|pass|fail)"
```
Expected: RB1, RB2, RB3 pass

**Step 5: Commit**

```bash
git add tests/fixtures/search-quality/code/order_processor.rb tests/fixtures/search-quality-qrels.ts tests/search-quality.test.ts
git commit -m "test: add Ruby OrderProcessor fixture and search quality QRels"
```

---

## Task 7: Frontend docs corpus — React/component documentation

**Problem:** Frontend repos represent a large share of real-world usage. No frontend/UI docs exist in the corpus.

**Files:**
- Create: `tests/fixtures/search-quality/md/frontend/components.md`
- Create: `tests/fixtures/search-quality/md/frontend/state-management.md`
- Create: `tests/fixtures/search-quality/md/frontend/hooks.md`
- Modify: `tests/search-quality.test.ts` (update markdown count from 12 → 15, add frontend facets)
- Modify: `tests/fixtures/search-quality-qrels.ts` (add frontend QRels)

**Step 1: Create `tests/fixtures/search-quality/md/frontend/components.md`**

```markdown
---
title: "Component Architecture"
description: "Design principles for reusable UI components using React."
tags: [react, components, props, composition, ui]
type: guide
category: frontend
---

# Component Architecture

A component-based UI architecture breaks the interface into isolated, reusable units.
Each component manages its own rendering logic and exposes a well-defined props API.

## Component Types

### Presentational Components

Presentational components focus purely on rendering. They receive all data via props
and emit events via callback props. They have no direct access to application state.

```tsx
interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onClick: () => void;
}

export function Button({ label, variant = "primary", disabled, onClick }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
```

### Container Components

Container components fetch data, manage local state, and pass data down to presentational
components. They are the boundary between the data layer and the UI layer.

### Compound Components

Compound components use React context to share state across related sub-components
without prop drilling:

```tsx
const TabContext = React.createContext<TabContextValue | null>(null);

export function Tabs({ children, defaultTab }: TabsProps) {
  const [active, setActive] = React.useState(defaultTab);
  return (
    <TabContext.Provider value={{ active, setActive }}>
      {children}
    </TabContext.Provider>
  );
}
```

## Props Design

- **Prefer composition over configuration** — instead of a 20-prop modal, use children.
- **Use discriminated unions for variant props** — `type: "success" | "error" | "warning"`.
- **Callback naming** — prefix with `on`: `onSubmit`, `onChange`, `onClose`.

## Component Lifecycle and Cleanup

Components that subscribe to external data sources (WebSocket, EventEmitter) must
clean up their subscriptions in the `useEffect` cleanup function to prevent memory leaks.
```

**Step 2: Create `tests/fixtures/search-quality/md/frontend/state-management.md`**

```markdown
---
title: "State Management Guide"
description: "Choosing and using state management in React apps: local state, context, and Zustand."
tags: [react, state, zustand, context, redux, store]
type: guide
category: frontend
---

# State Management Guide

State management is the practice of controlling how data flows and changes in your application.
Choosing the right approach depends on scope and update frequency.

## Local Component State

Use `useState` for UI-only state scoped to a single component:
- Form input values before submission
- Toggle visibility (modal open/closed)
- Loading indicators

```tsx
const [isOpen, setIsOpen] = useState(false);
const [formData, setFormData] = useState({ email: "", password: "" });
```

## React Context for Shared State

Context is suitable for low-frequency global values like theme, locale, or auth user.
Avoid context for high-frequency updates (use a store instead).

```tsx
export const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}
```

## Zustand for Application State

Zustand is a lightweight store library that avoids Redux boilerplate while
providing a subscription model that prevents unnecessary re-renders.

```typescript
interface CartStore {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  total: () => number;
}

const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  addItem: (item) => set(state => ({ items: [...state.items, item] })),
  removeItem: (id) => set(state => ({ items: state.items.filter(i => i.id !== id) })),
  total: () => get().items.reduce((sum, i) => sum + i.price * i.qty, 0),
}));
```

## When to Use What

| Scenario | Recommendation |
|---|---|
| Form input state | `useState` |
| Theme / locale | Context |
| Shopping cart, user session | Zustand / Redux |
| Server data with caching | React Query / SWR |
```

**Step 3: Create `tests/fixtures/search-quality/md/frontend/hooks.md`**

```markdown
---
title: "Custom Hooks Reference"
description: "Reference for common React custom hooks: data fetching, debounce, local storage, and intersection observer."
tags: [react, hooks, useEffect, custom-hooks, useFetch, debounce]
type: reference
category: frontend
---

# Custom Hooks Reference

Custom hooks encapsulate reusable stateful logic. By convention they start with `use`.

## useFetch — Data Fetching

Wraps `fetch` with loading/error state management:

```typescript
function useFetch<T>(url: string): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(res => res.json())
      .then(json => { if (!cancelled) setData(json); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  return { data, loading, error };
}
```

## useDebounce — Debounced Value

Delays propagating a value until the user stops changing it:

```typescript
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
```

## useLocalStorage — Persistent State

Syncs state to `localStorage` for persistence across page reloads:

```typescript
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [stored, setStored] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    setStored(value);
    window.localStorage.setItem(key, JSON.stringify(value));
  };

  return [stored, setValue];
}
```

## useIntersectionObserver — Lazy Loading

Detects when an element enters the viewport for lazy loading or infinite scroll:

```typescript
function useIntersectionObserver(
  ref: React.RefObject<Element>,
  options?: IntersectionObserverInit
): boolean {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      options
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, options]);
  return isVisible;
}
```
```

**Step 4: Add frontend QRels to `tests/fixtures/search-quality-qrels.ts`**

```typescript
// ── Frontend / React docs (5) ────────────────────────────────────────
{
  id: "FE1",
  query: "react component props composition",
  category: "exact",
  relevant: [
    { docTitle: "Component Architecture", relevance: 3 },
    { docTitle: "Component Architecture", nodeTitle: "Component Types", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "Component Architecture", k: 3 },
},
{
  id: "FE2",
  query: "zustand state store cart",
  category: "multi-term",
  relevant: [
    { docTitle: "State Management", nodeTitle: "Zustand", relevance: 3 },
    { docTitle: "State Management", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "State Management", nodeTitle: "Zustand", k: 5 },
},
{
  id: "FE3",
  query: "useFetch data loading error",
  category: "multi-term",
  relevant: [
    { docTitle: "Custom Hooks", nodeTitle: "useFetch", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "Custom Hooks", nodeTitle: "useFetch", k: 5 },
},
{
  id: "FE4",
  query: "debounce delay user input",
  category: "synonym",
  relevant: [
    { docTitle: "Custom Hooks", nodeTitle: "useDebounce", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "Custom Hooks", k: 5 },
},
{
  id: "FE5",
  query: "state management guide",
  category: "facet-filtered",
  filter: { type: ["guide"], category: ["frontend"] },
  relevant: [
    { docTitle: "State Management", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "State Management", k: 3 },
},
```

**Step 5: Update corpus sanity in `tests/search-quality.test.ts`**

```typescript
test("15 markdown documents indexed", () => {
  const listing = store.listDocuments({ collection: "docs", limit: 100 });
  expect(listing.total).toBe(15);
});
```

Add `frontend` to the type facets check (or add separate frontend category check).

**Step 6: Run tests**

```bash
bun test tests/search-quality.test.ts 2>&1 | grep -E "(FE[1-5]|pass|fail)"
```
Expected: All FE QRels pass

**Step 7: Commit**

```bash
git add tests/fixtures/search-quality/md/frontend/ tests/fixtures/search-quality-qrels.ts tests/search-quality.test.ts
git commit -m "test: add frontend/React docs corpus (components, state, hooks) with QRels"
```

---

## Task 8: Infrastructure docs corpus — Kubernetes, Helm, monitoring

**Problem:** Infrastructure/DevOps repos are a major use case. The current corpus has `deploy.md` / `rollback.md` but no cloud-native infrastructure vocabulary (Kubernetes, Helm, Terraform, Prometheus).

**Files:**
- Create: `tests/fixtures/search-quality/md/infra/kubernetes.md`
- Create: `tests/fixtures/search-quality/md/infra/monitoring.md`
- Modify: `tests/search-quality.test.ts` (update markdown count to 17)
- Modify: `tests/fixtures/search-quality-qrels.ts` (add infra QRels)

**Step 1: Create `tests/fixtures/search-quality/md/infra/kubernetes.md`**

```markdown
---
title: "Kubernetes Operations Guide"
description: "Day-2 Kubernetes operations: deployments, scaling, health checks, and namespace management."
tags: [kubernetes, k8s, pod, deployment, helm, namespace, autoscaling]
type: runbook
category: infrastructure
---

# Kubernetes Operations Guide

This guide covers common day-2 Kubernetes operations for production clusters.

## Deployments

### Rolling Update

Trigger a rolling update by updating the image tag in the deployment manifest:

```bash
kubectl set image deployment/api-server api=myregistry/api:v2.3.1 -n production
kubectl rollout status deployment/api-server -n production
```

Rolling updates replace pods incrementally without downtime. The default strategy
keeps `maxSurge: 1` and `maxUnavailable: 0`.

### Rollback a Deployment

If a rolling update fails health checks:

```bash
kubectl rollout undo deployment/api-server -n production
kubectl rollout history deployment/api-server -n production
```

## Horizontal Pod Autoscaling

HPA automatically scales replicas based on CPU/memory utilization:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Pod Health Checks

### Liveness Probe

Liveness probes restart the container if the application enters a bad state:

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

### Readiness Probe

Readiness probes stop routing traffic to pods that aren't ready:

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Namespace Management

Namespaces provide isolation between environments. Use separate namespaces
for `production`, `staging`, and `development`:

```bash
kubectl get pods -n production
kubectl describe pod api-server-xxx -n production
kubectl logs api-server-xxx -n production --tail=100
```
```

**Step 2: Create `tests/fixtures/search-quality/md/infra/monitoring.md`**

```markdown
---
title: "Monitoring and Alerting"
description: "Prometheus metrics, Grafana dashboards, and PagerDuty alert routing for production services."
tags: [prometheus, grafana, alerting, metrics, pagerduty, slo, sla, observability]
type: reference
category: infrastructure
---

# Monitoring and Alerting

Production observability requires three pillars: metrics, logs, and traces.
This guide covers the metrics layer using Prometheus and Grafana.

## Prometheus Metrics

### Instrument Your Service

Add metrics to your application using the Prometheus client library:

```go
var (
  requestDuration = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{
      Name:    "http_request_duration_seconds",
      Help:    "HTTP request duration in seconds",
      Buckets: prometheus.DefBuckets,
    },
    []string{"method", "path", "status"},
  )
  requestTotal = prometheus.NewCounterVec(
    prometheus.CounterOpts{
      Name: "http_requests_total",
      Help: "Total HTTP requests",
    },
    []string{"method", "path", "status"},
  )
)
```

### Scrape Configuration

Add your service to Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: api-server
    static_configs:
      - targets: ["api-server:9090"]
    scrape_interval: 15s
```

## Alerting Rules

Define SLO-based alert rules in Prometheus:

```yaml
groups:
  - name: api-slo
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error rate exceeds 1% SLO"
```

## Grafana Dashboards

### Key Panels

- **Request rate** — `rate(http_requests_total[5m])` per path
- **Error rate** — 5xx / total as percentage
- **P99 latency** — `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))`
- **Pod restarts** — `kube_pod_container_status_restarts_total`

## Incident Response

When PagerDuty fires an alert:
1. Check Grafana dashboard for the affected service
2. Review recent deployments in Argo CD
3. Check pod logs: `kubectl logs -l app=api-server --tail=200 -n production`
4. If needed: `kubectl rollout undo deployment/api-server -n production`
```

**Step 3: Add infra QRels**

```typescript
// ── Infrastructure / Kubernetes docs (4) ────────────────────────────
{
  id: "INF1",
  query: "kubernetes rolling update deployment",
  category: "exact",
  relevant: [
    { docTitle: "Kubernetes Operations", relevance: 3 },
    { docTitle: "Kubernetes Operations", nodeTitle: "Rolling Update", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "Kubernetes Operations", nodeTitle: "Rolling Update", k: 3 },
},
{
  id: "INF2",
  query: "horizontal pod autoscaling cpu replicas",
  category: "multi-term",
  relevant: [
    { docTitle: "Kubernetes Operations", nodeTitle: "Horizontal Pod Autoscaling", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "Kubernetes Operations", nodeTitle: "Horizontal Pod Autoscaling", k: 5 },
},
{
  id: "INF3",
  query: "prometheus metrics grafana dashboard error rate",
  category: "multi-term",
  relevant: [
    { docTitle: "Monitoring and Alerting", nodeTitle: "Grafana Dashboards", relevance: 3 },
    { docTitle: "Monitoring and Alerting", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "Monitoring and Alerting", k: 3 },
},
{
  id: "INF4",
  query: "liveness probe readiness health check",
  category: "discriminating",
  relevant: [
    { docTitle: "Kubernetes Operations", nodeTitle: "Liveness Probe", relevance: 3 },
    { docTitle: "Kubernetes Operations", nodeTitle: "Readiness Probe", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "Kubernetes Operations", nodeTitle: "Liveness Probe", k: 5 },
},
{
  id: "INF5",
  query: "infrastructure runbook",
  category: "facet-filtered",
  filter: { type: ["runbook"], category: ["infrastructure"] },
  relevant: [
    { docTitle: "Kubernetes Operations", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "Kubernetes Operations", k: 3 },
},
```

**Step 4: Update corpus sanity count to 17 markdown documents**

**Step 5: Run tests**

```bash
bun test tests/search-quality.test.ts 2>&1 | grep -E "(INF[1-5]|pass|fail)"
```
Expected: All INF QRels pass

**Step 6: Commit**

```bash
git add tests/fixtures/search-quality/md/infra/ tests/fixtures/search-quality-qrels.ts tests/search-quality.test.ts
git commit -m "test: add Kubernetes + monitoring docs corpus with infra QRels"
```

---

## Task 9: Data science docs corpus

**Problem:** ML/data science repos (model training, experiment tracking, pipeline management) have distinct vocabulary that differs from API/auth docs. No data science corpus exists.

**Files:**
- Create: `tests/fixtures/search-quality/md/data-science/model-training.md`
- Create: `tests/fixtures/search-quality/md/data-science/pipeline.md`
- Modify: `tests/search-quality.test.ts` (update markdown count to 19)
- Modify: `tests/fixtures/search-quality-qrels.ts` (add data science QRels)

**Step 1: Create `tests/fixtures/search-quality/md/data-science/model-training.md`**

```markdown
---
title: "Model Training Guide"
description: "Training, evaluating, and checkpointing ML models using PyTorch and experiment tracking with MLflow."
tags: [machine-learning, training, pytorch, loss, epoch, checkpoint, mlflow, evaluation]
type: guide
category: data-science
---

# Model Training Guide

This guide covers the standard training loop, evaluation, and experiment tracking
for supervised ML models.

## Training Loop

### Basic Training Loop

```python
for epoch in range(num_epochs):
    model.train()
    for batch_idx, (data, target) in enumerate(train_loader):
        optimizer.zero_grad()
        output = model(data)
        loss = criterion(output, target)
        loss.backward()
        optimizer.step()

    val_loss, val_accuracy = evaluate(model, val_loader)
    print(f"Epoch {epoch}: val_loss={val_loss:.4f} val_acc={val_accuracy:.4f}")
```

### Loss Functions

| Task | Loss Function | When to Use |
|---|---|---|
| Binary classification | `BCEWithLogitsLoss` | Sigmoid output layer |
| Multi-class classification | `CrossEntropyLoss` | Softmax output |
| Regression | `MSELoss` / `HuberLoss` | Continuous targets |

## Model Evaluation

### Metrics

Standard classification metrics:

- **Accuracy** — fraction of correct predictions
- **Precision** — TP / (TP + FP) — how many predicted positives are correct
- **Recall** — TP / (TP + FN) — how many actual positives are caught
- **F1 Score** — harmonic mean of precision and recall
- **AUC-ROC** — area under the receiver operating characteristic curve

### Confusion Matrix

```python
from sklearn.metrics import confusion_matrix, classification_report
y_pred = model_predict(test_loader)
print(classification_report(y_test, y_pred))
```

## Checkpointing

Save model state after each epoch to resume training after interruption:

```python
torch.save({
    "epoch": epoch,
    "model_state_dict": model.state_dict(),
    "optimizer_state_dict": optimizer.state_dict(),
    "val_loss": val_loss,
}, f"checkpoints/model_epoch_{epoch}.pt")
```

To resume:
```python
checkpoint = torch.load("checkpoints/model_epoch_10.pt")
model.load_state_dict(checkpoint["model_state_dict"])
optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
```

## Experiment Tracking with MLflow

```python
import mlflow

with mlflow.start_run():
    mlflow.log_param("lr", learning_rate)
    mlflow.log_param("batch_size", batch_size)
    mlflow.log_metric("val_loss", val_loss, step=epoch)
    mlflow.log_metric("val_accuracy", val_accuracy, step=epoch)
    mlflow.pytorch.log_model(model, "model")
```
```

**Step 2: Create `tests/fixtures/search-quality/md/data-science/pipeline.md`**

```markdown
---
title: "ML Data Pipeline"
description: "Building reproducible data preprocessing and feature engineering pipelines with scikit-learn and Apache Airflow."
tags: [pipeline, feature-engineering, preprocessing, etl, airflow, scikit-learn, data-validation]
type: architecture
category: data-science
---

# ML Data Pipeline

A data pipeline transforms raw input data into model-ready features through a
sequence of preprocessing and feature engineering steps.

## Pipeline Architecture

```
Raw Data → Validation → Preprocessing → Feature Engineering → Train/Val/Test Split → Model
```

## Data Validation

Validate incoming data before feeding it to the pipeline:

- **Schema validation** — verify column names and types
- **Range checks** — values within expected bounds
- **Missing value audit** — flag columns exceeding 5% null rate
- **Distribution drift detection** — alert on significant statistical changes

```python
from great_expectations import DataContext
context = DataContext()
result = context.run_checkpoint(checkpoint_name="raw_data_checks")
assert result.success, f"Data validation failed: {result}"
```

## Preprocessing

### Numeric Features

```python
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

numeric_pipeline = Pipeline([
    ("impute", SimpleImputer(strategy="median")),
    ("scale", StandardScaler()),
])
```

### Categorical Features

```python
from sklearn.preprocessing import OneHotEncoder

categorical_pipeline = Pipeline([
    ("impute", SimpleImputer(strategy="most_frequent")),
    ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
])
```

## Feature Engineering

### Temporal Features

Extract calendar features from datetime columns:

```python
df["hour"] = df["timestamp"].dt.hour
df["day_of_week"] = df["timestamp"].dt.dayofweek
df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
```

### Interaction Features

```python
df["price_per_unit"] = df["total_price"] / df["quantity"].clip(lower=1)
df["review_ratio"] = df["positive_reviews"] / df["total_reviews"].clip(lower=1)
```

## Airflow DAG

Orchestrate the pipeline as a DAG with daily scheduling:

```python
from airflow import DAG
from airflow.operators.python import PythonOperator

with DAG("ml_pipeline", schedule_interval="@daily", catchup=False) as dag:
    validate  = PythonOperator(task_id="validate_data",   python_callable=validate_data)
    preprocess = PythonOperator(task_id="preprocess",     python_callable=run_preprocessing)
    features  = PythonOperator(task_id="feature_engineer", python_callable=engineer_features)
    train     = PythonOperator(task_id="train_model",     python_callable=train_model)

    validate >> preprocess >> features >> train
```
```

**Step 3: Add data science QRels**

```typescript
// ── Data science docs (4) ────────────────────────────────────────────
{
  id: "DS1",
  query: "model training loss epoch pytorch",
  category: "multi-term",
  relevant: [
    { docTitle: "Model Training", nodeTitle: "Training Loop", relevance: 3 },
    { docTitle: "Model Training", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "Model Training", nodeTitle: "Training Loop", k: 5 },
},
{
  id: "DS2",
  query: "checkpoint save resume model",
  category: "multi-term",
  relevant: [
    { docTitle: "Model Training", nodeTitle: "Checkpointing", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "Model Training", nodeTitle: "Checkpointing", k: 5 },
},
{
  id: "DS3",
  query: "feature engineering preprocessing pipeline scikit",
  category: "multi-term",
  relevant: [
    { docTitle: "ML Data Pipeline", nodeTitle: "Preprocessing", relevance: 3 },
    { docTitle: "ML Data Pipeline", nodeTitle: "Feature Engineering", relevance: 2 },
  ],
  mustBeInTop: { docTitle: "ML Data Pipeline", k: 3 },
},
{
  id: "DS4",
  query: "precision recall f1 score evaluation",
  category: "multi-term",
  relevant: [
    { docTitle: "Model Training", nodeTitle: "Model Evaluation", relevance: 3 },
  ],
  mustBeInTop: { docTitle: "Model Training", nodeTitle: "Model Evaluation", k: 5 },
},
```

**Step 4: Update corpus count to 19 markdown documents**

**Step 5: Run tests**

```bash
bun test tests/search-quality.test.ts 2>&1 | grep -E "(DS[1-4]|pass|fail)"
```
Expected: All DS QRels pass

**Step 6: Commit**

```bash
git add tests/fixtures/search-quality/md/data-science/ tests/fixtures/search-quality-qrels.ts tests/search-quality.test.ts
git commit -m "test: add data science (ML training + pipeline) docs corpus with QRels"
```

---

## Task 10: Per-language and per-type NDCG tracking

**Problem:** The aggregate NDCG@10 is measured across all QRels, but we can't detect per-language or per-type regressions. A degradation in Go search quality would be hidden inside the overall score.

**Files:**
- Modify: `tests/search-quality.test.ts` (add per-language and per-type NDCG describe blocks)

**Step 1: Write the failing per-language test first (before adding new QRels)**

Add to `tests/search-quality.test.ts` after the existing aggregate metrics block:

```typescript
// ═══════════════════════════════════════════════════════════════════════════════
// 12. Per-language code search quality
// ═══════════════════════════════════════════════════════════════════════════════

describe("Per-Language Code Search Quality", () => {
  const LANGUAGE_CATEGORIES = [
    { lang: "java",       qrelIds: ["C1", "C2", "F2"] },
    { lang: "python",     qrelIds: ["C3", "F3"] },
    { lang: "typescript", qrelIds: ["C4", "C7"] },
    { lang: "go",         qrelIds: ["C5"] },
    { lang: "rust",       qrelIds: ["C6"] },
    { lang: "cpp",        qrelIds: ["CPP1", "CPP2", "CPP3"] },
    { lang: "csharp",     qrelIds: ["CS1", "CS2", "CS3"] },
    { lang: "ruby",       qrelIds: ["RB1", "RB2"] },
  ];

  for (const { lang, qrelIds } of LANGUAGE_CATEGORIES) {
    test(`NDCG@10 >= 0.65 for ${lang} code queries`, () => {
      const langQrels = resolveQRels(
        QRELS.filter(q => qrelIds.includes(q.id))
      ).filter(q => q.hasAnyRelevant);

      if (langQrels.length === 0) return; // no QRels yet for this language

      const scores = langQrels.map(qr => {
        const ranked = runQuery(qr.query, qr.filter, 10);
        return ndcgAtK(ranked, qr.relevance, 10);
      });
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      expect(mean).toBeGreaterThanOrEqual(0.65);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Per-repo-type doc search quality
// ═══════════════════════════════════════════════════════════════════════════════

describe("Per-Repo-Type Doc Search Quality", () => {
  const REPO_CATEGORIES = [
    { name: "authentication",  qrelIds: ["E1", "E2", "E8", "S1", "S2", "D1"] },
    { name: "api-reference",   qrelIds: ["E3", "E7", "M3", "M4", "D4"] },
    { name: "operations",      qrelIds: ["E4", "M5", "D2", "F1", "F4"] },
    { name: "architecture",    qrelIds: ["E6", "M7"] },
    { name: "frontend",        qrelIds: ["FE1", "FE2", "FE3", "FE4"] },
    { name: "infrastructure",  qrelIds: ["INF1", "INF2", "INF3", "INF4"] },
    { name: "data-science",    qrelIds: ["DS1", "DS2", "DS3", "DS4"] },
  ];

  for (const { name, qrelIds } of REPO_CATEGORIES) {
    test(`NDCG@10 >= 0.65 for ${name} queries`, () => {
      const typeQrels = resolveQRels(
        QRELS.filter(q => qrelIds.includes(q.id))
      ).filter(q => q.hasAnyRelevant);

      if (typeQrels.length === 0) return;

      const scores = typeQrels.map(qr => {
        const ranked = runQuery(qr.query, qr.filter, 10);
        return ndcgAtK(ranked, qr.relevance, 10);
      });
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      expect(mean).toBeGreaterThanOrEqual(0.65);
    });
  }
});
```

**Step 2: Run tests to confirm new describe blocks appear and pass**

```bash
bun test tests/search-quality.test.ts --filter "Per-Language" 2>&1 | grep -E "(pass|fail|PASS|FAIL)"
bun test tests/search-quality.test.ts --filter "Per-Repo-Type" 2>&1 | grep -E "(pass|fail|PASS|FAIL)"
```
Expected: All per-language and per-type tests pass with NDCG ≥ 0.65

**Step 3: Run the full suite one final time**

```bash
bun test tests/search-quality.test.ts 2>&1 | tail -10
```
Expected: All tests pass, total count significantly higher than original 65

**Step 4: Commit**

```bash
git add tests/search-quality.test.ts
git commit -m "test: add per-language and per-repo-type NDCG tracking tests"
```

---

## Task 11: Final validation and summary

**Step 1: Run complete test suite**

```bash
bun test 2>&1 | tail -20
```
Expected: ALL tests pass (no regressions, new tests green)

**Step 2: Verify NDCG thresholds still hold with larger corpus**

The aggregate NDCG thresholds in the existing test (`≥ 0.65 overall`, `≥ 0.85 exact-match`, `MRR ≥ 0.70`) are calculated over all non-zero-result QRels. Adding 30+ new QRels may shift the mean. If the existing thresholds are at risk:
- Check which QRels score lowest with the debug output already in the test
- Adjust thresholds conservatively if needed (document reason in a comment)

**Step 3: Confirm parser dispatch is correct**

```bash
DOCS_ROOT=./tests/fixtures/search-quality/md CODE_ROOT=./tests/fixtures/search-quality/code bun run index 2>&1 | grep -E "(\.go|\.rs|\.cpp|\.cs|\.rb)" | head -20
```
Expected: `.go` files dispatched to Go parser, `.rs` to Rust parser, C++/C#/Ruby to generic

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete search quality expansion — Go/Rust parsers, C++/C#/Ruby fixtures, frontend/infra/data-science corpus, per-language NDCG"
```

---

## Summary of Deliverables

| Deliverable | Files | Tests Added |
|---|---|---|
| Go dedicated parser | `src/parsers/go.ts` | ~7 parser tests + N9 navigation (3 tests) |
| Rust dedicated parser | `src/parsers/rust.ts` | ~7 parser tests + N10 navigation (3 tests) |
| C++ fixture | `code/connection_pool.cpp` | CPP1–CPP3 (3 QRels) |
| C# fixture | `code/UserService.cs` | CS1–CS3 (3 QRels) |
| Ruby fixture | `code/order_processor.rb` | RB1–RB3 (3 QRels) |
| Frontend docs | `md/frontend/` (3 files) | FE1–FE5 (5 QRels) |
| Infrastructure docs | `md/infra/` (2 files) | INF1–INF5 (5 QRels) |
| Data science docs | `md/data-science/` (2 files) | DS1–DS4 (4 QRels) |
| Per-language NDCG | `search-quality.test.ts` | 8 language tests |
| Per-type NDCG | `search-quality.test.ts` | 7 type tests |

**Before:** 65 tests, 40 QRels, 5 languages, 1 repo type domain
**After:** ~115 tests, ~70 QRels, 8 languages, 4 repo type domains, structured per-language CI gates
