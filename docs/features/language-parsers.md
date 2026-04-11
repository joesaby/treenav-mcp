# Language parsers

## Summary

Six parsers that turn source files into `[]types.TreeNode`: TypeScript
(also handles JavaScript), Python, Go, Rust, Java, and a generic
regex-based fallback for everything else. Every parser satisfies the
`codeindex.Parser` interface so the coordinator can dispatch to them by
extension without per-language branches in its own code.

Five of the six are straight ports of the TypeScript regex-based
parsers — same patterns, same edge cases, same node shapes. The sixth,
**Go**, is upgraded to use stdlib `go/parser` + `go/ast` because the
migration ADR calls that out as a free accuracy win: a real AST for
the language the tool is now written in, courtesy of the stdlib we
already depend on, with no extra cost.

The parsers are "leaves" in the dependency graph — they depend only on
`internal/types` and the Go stdlib. The coordinator
(`internal/codeindex`) calls them; they do not call back.

## Go package

`internal/parsers/typescript`, `internal/parsers/python`,
`internal/parsers/golang`, `internal/parsers/rust`,
`internal/parsers/java`, `internal/parsers/generic` — one sub-package
per language.

Each sub-package exports exactly one value of a public type and one
`init()` that registers it with `codeindex.DefaultRegistry()`:

```go
package <lang>

var Parser codeindex.Parser = parser{}

func init() {
    codeindex.Register(Parser)
}

type parser struct{}
func (parser) Extensions() []string { /* ... */ }
func (parser) Parse(path, source, docID string) ([]types.TreeNode, error)
```

Keeping each parser in its own sub-package (rather than one big
`internal/parsers`) means they can be imported independently, have
independent test fixtures in `internal/parsers/<lang>/testdata/`, and
can be audited individually in a Phase C PR.

## Public API (Go signatures)

```go
// internal/parsers/typescript
package typescript

var Extensions = []string{".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"}
var Parser codeindex.Parser

// internal/parsers/python
package python

var Extensions = []string{".py", ".pyi"}
var Parser codeindex.Parser

// internal/parsers/golang  (package name is "golang" to avoid shadowing "go")
package golang

var Extensions = []string{".go"}
var Parser codeindex.Parser

// internal/parsers/rust
package rust

var Extensions = []string{".rs"}
var Parser codeindex.Parser

// internal/parsers/java
package java

var Extensions = []string{".java"}
var Parser codeindex.Parser

// internal/parsers/generic
package generic

var Extensions = []string{
    ".kt", ".scala",
    ".c", ".cpp", ".cc", ".h", ".hpp",
    ".cs", ".rb", ".swift", ".php",
    ".lua", ".r", ".R", ".sh", ".bash", ".zsh",
}
var Parser codeindex.Parser
```

Every `Parser` value, called through the interface, produces a flat
slice of `types.TreeNode` with:

- `NodeID` = `"<docID>:n<counter>"` (counter starts at 1, increments
  monotonically over the file).
- `Title` = `"<kind> <name>"` (e.g. `"class AuthService"`) — except for
  import blocks, whose title is the bare word `"imports"`.
- `Level` = 1 for top-level symbols, 2 for methods, 3 for properties,
  always 1 for imports and type aliases.
- `ParentID` = non-nil only for methods and properties that belong to
  an enclosing class/interface/struct/trait.
- `Content` = exact source bytes from `line_start..line_end` inclusive.
- `Summary` = first 200 characters of the symbol signature.

## Key behaviors

- **Pure regex for 5 of 6.** TypeScript, Python, Rust, Java, and the
  generic parser use `regexp`. The TS patterns in
  `src/parsers/*.ts` are the authoritative extraction rules; Go is a
  verbatim port. Any RE2 incompatibilities in the source patterns are
  called out in the spec (no backrefs, no lookahead — but the TS
  patterns don't use those anyway, audit performed).
- **AST for Go.** `internal/parsers/golang` uses `go/parser.ParseFile`
  with `parser.SkipObjectResolution|parser.ParseComments` to get an
  `*ast.File`, then walks top-level `Decls` for `*ast.FuncDecl`,
  `*ast.TypeSpec`, and `*ast.GenDecl` (const/var/import). Receiver
  methods on `*ast.FuncDecl` link back to their type by name; the
  resolution pass happens after the first traversal so method order
  does not matter.
- **Brace-depth tracking.** Every non-Python parser uses the same
  helper (`findBraceBlockEnd`) to find the closing `}` that matches
  the first `{` at or after a declaration line. The generic parser
  also ships `findRubyBlockEnd` which counts `class`/`def`/`do` vs.
  `end` keywords for Ruby files.
- **Export detection is language-specific.** TS looks for leading
  `export`. Python uses "not underscore-prefixed". Go uses "first letter
  uppercase". Rust uses leading `pub`. Java uses `public` in the
  modifier list. The generic parser dispatches to the right rule via
  a per-language `Lang` enum.
- **Import blocks collapse to one node.** Every parser groups
  consecutive import/package/use statements into a single TreeNode of
  kind `"import"` with title `"imports"`. This keeps `get_tree`
  outlines readable and lets agents jump to dependencies without
  skimming past one node per statement.
- **Decorators, annotations, attributes are preserved in content.**
  Python `@decorator`, Java `@Annotation`, Rust `#[attr]` are included
  in the node's `line_start..line_end` range and embedded in the
  signature string.

## Per-language summary (details live in the spec)

### TypeScript / JavaScript

- **Extensions:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`
  (`src/parsers/typescript.ts:14`).
- **Kinds:** `class`, `interface`, `function`, `method`, `property`,
  `type`, `enum`, `variable`, `import`.
- **Strategy:** regex line-by-line; `findBlockEnd` walks braces to
  close each declaration. Arrow functions assigned to `const` are
  classified as `function`.
- **Known limits:** No distinguishing between `.ts` and `.tsx` —
  both use the same parser. Arrow functions inside object literals
  assigned to `export const` are heuristically identified via
  `isArrowFunctionContent` at `src/parsers/typescript.ts:490`. No
  JSDoc parsing.
- **Tree shape:** class → methods (level 2) → (no grandchildren);
  interface → methods + properties (level 2). Standalone functions
  and type aliases are level 1 with no children.

### Python

- **Extensions:** `.py`, `.pyi` (`src/parsers/python.ts:14`).
- **Kinds:** `class`, `function`, `method`, `variable`, `import`.
- **Strategy:** indentation-based block detection. A `class`/`def`
  line is the start; the block ends when indentation returns to the
  same level or lower, ignoring blank lines and comment-only lines.
- **Known limits:** The indent parser counts raw character indentation
  and does **not** handle tabs mixed with spaces in the same file.
  Files that use both will mis-nest methods. Nested classes and
  closures are not walked — only top-level and one layer of class
  members are extracted.
- **Tree shape:** class → methods (level 2). Standalone functions and
  `UPPER_CASE` module constants are level 1.

### Go

- **Extensions:** `.go` (`src/parsers/go.ts:15`).
- **Kinds:** `class` (for struct), `interface`, `type`, `method`,
  `function`, `variable`, `import`.
- **Strategy:** `go/parser.ParseFile` + `go/ast`. `*ast.FuncDecl`
  without a receiver → `function`. `*ast.FuncDecl` with a receiver →
  `method`, parent id resolved from the receiver type name. `*ast.TypeSpec`
  with `*ast.StructType` → `class`. `*ast.TypeSpec` with `*ast.InterfaceType`
  → `interface`. Other `*ast.TypeSpec` → `type`. `*ast.GenDecl` of
  `token.CONST`/`token.VAR` → `variable`. Line numbers from the
  `token.FileSet`.
- **Known limits:** Generic type parameters are included in the
  signature string but not structured. A receiver on an interface
  embedding still produces a method node because `go/ast` reports it
  as one. The TS regex parser handled generic receivers
  (`func (s *Set[T]) Add(...)`) via a regex branch at
  `src/parsers/go.ts:119`; the AST parser handles them natively.
- **Tree shape:** struct/interface → methods (level 2). Top-level
  functions, type aliases, and grouped const/var blocks are level 1.

### Rust

- **Extensions:** `.rs` (`src/parsers/rust.ts:23`).
- **Kinds:** `class` (for struct), `enum`, `interface` (for trait),
  `method`, `function`, `variable`, `type`.
- **Strategy:** Two-pass regex. Pass 1 builds a `typeName → id` map
  from `struct`/`enum`/`trait` declarations. Pass 2 walks `impl`
  blocks (both `impl Name` and `impl Trait for Name`) and attaches
  their `fn`s to the parent type by name. Top-level `fn`, `const`,
  `static`, and `type` aliases are extracted in pass 2 as level-1
  nodes.
- **Known limits:** Tuple structs (`struct Foo(u32);`) and unit
  structs (`struct Unit;`) are detected but produce empty content
  blocks. Macros (`macro_rules!`, `macro!`) are ignored. Trait
  methods without a body inside `trait` blocks are not extracted as
  separate children — only methods inside `impl` blocks are. Generic
  lifetime bounds in `impl<'a, T: Trait>` are tolerated by the regex.
- **Tree shape:** struct/enum/trait → impl methods (level 2) with
  `parent_id` pointing to the type. Top-level `fn`, `const`,
  `static`, and `type` → level 1.

### Java

- **Extensions:** `.java` (`src/parsers/java.ts:19`).
- **Kinds:** `class`, `interface`, `enum`, `method`, `import`.
  Record types and `@interface` annotation definitions both map to
  `class` and `interface` respectively.
- **Strategy:** Annotation-aware regex. A single "pending annotations"
  buffer is flushed onto the next type/method declaration. Method
  detection uses a discriminator function (`detectJavaMethod` at
  `src/parsers/java.ts:326`) that rejects field initializers
  (`=` before `(`), method-call chains (`.` before the name), and
  control-flow keywords. Inner classes recurse via the same member
  parser.
- **Known limits:** No distinction between constructors and regular
  methods beyond the `name == enclosingClassName` check. Lambdas are
  not extracted as nodes. Static initializer blocks (`static { ... }`)
  are tolerated but not extracted. String literals containing `{` or
  `}` can confuse brace-depth tracking (same as every regex parser).
- **Tree shape:** class/interface/enum/record/@interface → methods
  (level 2). Inner types → children (level 2) of their enclosing
  type. No property-level children.

### Generic (fallback)

- **Extensions:** `.kt`, `.scala`, `.c`, `.cpp`, `.cc`, `.h`, `.hpp`,
  `.cs`, `.rb`, `.swift`, `.php`, `.lua`, `.r`, `.R`, `.sh`, `.bash`,
  `.zsh` (`src/parsers/generic.ts:15-20`).
- **Kinds:** `class`, `interface`, `enum`, `function`, `method`,
  `variable`, `import`.
- **Strategy:** language-tuned regex, selected by a `Lang` enum
  (`go` / `java` / `c` / `ruby` / `shell` / `other`). The generic
  parser also covers Go files if the Go-specific parser is disabled,
  though under the normal Phase C wiring the Go-specific parser wins.
  C++ files get a dedicated `ClassName::method(` branch for
  implementation files. Ruby uses its own `findRubyBlockEnd` that
  counts `end` keywords. Shell functions match
  `function name()` / `name()` patterns.
- **Known limits:** The long tail of syntactic quirks — Kotlin `object`
  declarations, Scala case classes with implicit parameters, C macros
  that expand to function-like shapes, Ruby metaprogramming — is
  best-effort. The generic parser exists to give agents a foothold
  into unfamiliar code, not to match a language server.
- **Tree shape:** class/struct → methods (level 2). Top-level
  functions and constants → level 1.

## Dependencies

- **stdlib:** `regexp`, `strings`, `unicode`, `bufio` (Go parser
  uses `go/parser`, `go/ast`, `go/token`).
- **third-party:** none. Every parser is stdlib-only.
- **internal:** `internal/types` (for `TreeNode`), `internal/codeindex`
  (for the `Parser` interface and registry hook).

## Relationship to TS source

- Files port one-to-one:
  - `src/parsers/typescript.ts` → `internal/parsers/typescript/typescript.go`
  - `src/parsers/python.ts` → `internal/parsers/python/python.go`
  - `src/parsers/go.ts` → `internal/parsers/golang/golang.go` (with
    behavioral upgrade to AST)
  - `src/parsers/rust.ts` → `internal/parsers/rust/rust.go`
  - `src/parsers/java.ts` → `internal/parsers/java/java.go`
  - `src/parsers/generic.ts` → `internal/parsers/generic/generic.go`
- Every parser skips the `CodeSymbol` intermediate representation the
  TS code used (`src/code-indexer.ts:43-54`) and produces
  `types.TreeNode` directly. The bookkeeping (`parent_id`,
  `children_ids`, `line_start`, `line_end`) happens on local stack
  variables and is written into the TreeNode at emit time.
- Fixture-parity tests compare the Go `[]TreeNode` output against
  JSON captured from the TS parsers on the same input files. The Go
  parser is required to produce identical `NodeID`, `Title`, `Level`,
  `ParentID`, and `{Line,Line}` values byte-for-byte. `Content`
  matches bytewise; `Summary` matches after trimming to 200 chars.

## Non-goals

- **No semantic analysis.** Type resolution, import tracking, symbol
  references, unused-variable warnings — none of these are in scope.
  This is a navigation index, not a compiler front-end.
- **No incremental parsing.** Every parse is full-file. The
  incrementality story lives one level up, in `internal/store.AddDocument`
  keyed on `DocumentMeta.ContentHash`.
- **No nested class/function extraction beyond one level.** A class
  inside a function inside a class is not represented. Java gets inner
  classes as level-2 children; nobody else does.
- **No unified AST across languages.** Each parser owns its own
  representation internally and emits the same shape only at the
  TreeNode boundary.
- **No plugin API for new languages.** Adding a language means a new
  sub-package under `internal/parsers/` that registers itself at
  init time. There is no dynamic loading.
