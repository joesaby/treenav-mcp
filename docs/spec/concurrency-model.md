# Spec: Concurrency model

**Feature doc:** [../features/concurrency-model.md](../features/concurrency-model.md)
**TS source:** `src/store.ts`, `src/curator.ts`, `src/server.ts`, `src/server-http.ts`
**Go package:** cross-cutting (authoritative for `internal/store`; referenced by every caller)

## Scope

This spec fixes the locking discipline for every goroutine that can
observe `internal/store` state. It is binding on:

- `internal/store` — which holds the one and only `sync.RWMutex`
  for the index.
- `internal/curator` — which is the only non-test caller of
  `store.AddDocument` in production.
- `internal/mcp` — which wraps store calls from tool handlers that
  `mcp-go` may schedule on independent goroutines.
- `cmd/treenav-mcp` — which must finish bulk indexing before it
  connects a transport.

It is **not** binding on `internal/indexer`, `internal/safepath`,
`internal/frontmatter`, `internal/tokenize`, or any of the
`internal/parsers/*` packages. Those are pure-functional, own no
shared state, and have no locking requirements.

## Rules

### R1. The store owns exactly one lock

`internal/store.DocumentStore` declares one `sync.RWMutex` as an
unexported field named `mu`. No other mutex exists anywhere in the
package. No package outside `internal/store` locks anything.

### R2. Every exported method is lock-aware

Every method on `DocumentStore` is categorized as reader or writer
at definition time:

| Method | Lock type |
|---|---|
| `Load` | writer (`Lock`) |
| `AddDocument` | writer (`Lock`) |
| `LoadGlossary` | writer (`Lock`) |
| `SetCollectionWeight` | writer (`Lock`) |
| `Search` | reader (`RLock`) |
| `ListDocuments` | reader (`RLock`) |
| `GetTree` | reader (`RLock`) |
| `GetNodeContent` | reader (`RLock`) |
| `NavigateTree` | reader (`RLock`) |
| `ResolveRef` | reader (`RLock`) |
| `GetDocMeta` | reader (`RLock`) |
| `GetGlossaryTerms` | reader (`RLock`) |
| `GetStats` | reader (`RLock`) |
| `FindSymbol` | reader (`RLock`) |

Every such method uses the deferred-unlock idiom:

```go
func (s *DocumentStore) Search(q string, opts SearchOptions) []SearchResult {
    s.mu.RLock()
    defer s.mu.RUnlock()
    // ... locked body ...
}
```

No method takes the lock inside a helper and releases it in the
caller; lock acquisition and release live on the same stack frame.

### R3. Unexported helpers are caller-locked

Private helpers on `DocumentStore` (e.g. `rebuildNodeStats`,
`buildFilterIndex`, `removeDocumentPostings`) **assume** the caller
holds the write lock. They never lock and never unlock. Their
doc comments declare the lock precondition:

```go
// rebuildNodeStats recomputes per-node length stats.
// Precondition: s.mu is held for writing.
func (s *DocumentStore) rebuildNodeStats() { ... }
```

### R4. Snapshot before return

Any method that returns a slice, map, or pointer into store state
copies the data under the lock before returning. The snapshot rule
applies to:

- `ListDocuments` — returns `[]DocumentMeta` by copy.
- `GetDocMeta` — returns `DocumentMeta` by value (not a pointer).
- `GetGlossaryTerms` — returns a fresh `[]string` with
  `make([]string, 0, n)`.
- `GetTree` and `NavigateTree` — deep-copy the `TreeNode` subtree,
  including the `Children` slice of each node.
- `Search` — builds the `[]SearchResult` inside the locked region
  and returns it.
- `GetStats` — returns `IndexStats` by value.
- `FindSymbol` — returns `[]SymbolMatch` by copy.

The test suite enforces snapshot semantics with a "mutate the
returned slice, re-read the same query, assert no drift" case for
each method.

### R5. No lock held across an external call

While holding `s.mu` (read or write), the store must not:

1. Call any method on another `internal/*` package.
2. Send to or receive from a channel that is not owned by the
   store.
3. Start a new goroutine.
4. Call `time.Sleep` or any blocking I/O.
5. Call a caller-supplied callback. (The current API has none.
   If one is added, it must be called after `Unlock`.)

This rule is what makes deadlock impossible: the store is a leaf
in the call graph. Everyone calls into it; it calls nothing back
out.

### R6. Startup indexing is single-goroutine

`cmd/treenav-mcp/main.go` runs in this order:

1. Parse environment into `Config`.
2. Construct `DocumentStore` (empty).
3. Walk filesystem and build `[]IndexedDocument` via
   `internal/indexer.IndexAll`.
4. Call `store.Load(docs)`.
5. Load glossary if present.
6. Connect stdio or HTTP transport.
7. Serve.

Steps 1-5 run on the single `main` goroutine. No reader goroutine
exists. `Load` still takes the write lock (discipline), but the
lock is uncontended. The race detector observes no conflicting
access during startup because no other goroutine has been created
yet.

After step 6, the MCP layer may spawn handler goroutines. Any
subsequent `AddDocument` (from the curator) must lock, because
those handler goroutines can read concurrently.

### R7. Curator is the only non-test writer

In production, `store.AddDocument` is called from exactly one code
path: `internal/curator.WriteWikiEntry` after a successful disk
write. No tool handler, no indexer pass, and no HTTP middleware
calls `AddDocument` directly. This keeps the write frequency
predictable (user-initiated only) and makes the "writes are rare,
reads are hot" assumption auditable.

Test code may call `Load` and `AddDocument` freely — tests run on
their own goroutines and exercise the lock on purpose.

### R8. `go test -race` is mandatory

CI runs `go test -race ./...` on every push to the port branch. A
data-race report from any package is a hard failure, not a
flake-retry. Specifically for the store, `tests/go/store_race_test.go`
spins up:

- N=16 reader goroutines, each running a mix of `Search`,
  `ListDocuments`, `GetTree`, and `FindSymbol` in a tight loop.
- 1 writer goroutine running `AddDocument` on a rotating set of
  synthetic docs.
- A 2-second wall-clock timer, after which all goroutines are
  cancelled via a shared `context.Context`.

The test passes if and only if the race detector reports zero
conflicts. If the race detector is not enabled (`-race` flag
absent) the test short-circuits with `t.Skip("requires -race")`
so a local `go test ./...` without the flag does not produce a
misleading green.

### R9. The MCP layer passes the store by pointer

Tool handlers registered via `internal/mcp.RegisterTools` receive a
`*DocumentStore` captured in a closure. They do not copy the store,
do not hold it by interface value, and do not store it in global
state. This keeps the `mu` addressable through every handler and
lets the race detector connect the dots.

### R10. No lock leakage through error paths

Every locked method's `defer s.mu.RUnlock()` or `defer s.mu.Unlock()`
is placed immediately after the successful `RLock` / `Lock` call,
before any branch that could `return` early. The classic Go bug of
"locked, early-returned on error, never unlocked" is not allowed in
this package.

## Invariants

1. **I1 — Lock ownership is well-defined.** At any instant, the
   store's mutex is either unlocked, held for reading by zero or
   more goroutines, or held for writing by exactly one goroutine.
   Never both.
2. **I2 — No locked callouts.** No goroutine holding `s.mu` ever
   executes code outside the `internal/store` package.
3. **I3 — Snapshot immutability.** Once a reader method returns,
   the returned data shares no memory with live store state. A
   subsequent `AddDocument` cannot mutate a previously returned
   slice.
4. **I4 — Startup race-freedom.** No goroutine other than `main`
   touches the store before `transport.Connect()` returns.
5. **I5 — Race-detector clean.** `go test -race ./internal/store/...`
   and `go test -race ./internal/curator/...` report zero data
   races on a successful build.

## Patterns

### P1 — Deferred-unlock reader

```go
func (s *DocumentStore) Search(q string, opts SearchOptions) []SearchResult {
    s.mu.RLock()
    defer s.mu.RUnlock()
    // build and return []SearchResult entirely inside the locked region
}
```

### P2 — Deferred-unlock writer

```go
func (s *DocumentStore) AddDocument(doc IndexedDocument) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if existing, ok := s.docs[doc.Meta.DocID]; ok {
        s.removeDocumentPostings(existing) // caller-locked helper
    }
    s.docs[doc.Meta.DocID] = doc
    s.indexDocument(doc)   // caller-locked helper
    s.rebuildNodeStats()   // caller-locked helper
    return nil
}
```

### P3 — Snapshot-and-return

```go
func (s *DocumentStore) GetGlossaryTerms() []string {
    s.mu.RLock()
    defer s.mu.RUnlock()
    out := make([]string, 0, len(s.glossary))
    for term := range s.glossary {
        out = append(out, term)
    }
    return out // caller may mutate freely; store state is unaffected
}
```

### P4 — Deep-copy tree subtree

```go
func (s *DocumentStore) GetTree(docID string) (TreeOutline, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    doc, ok := s.docs[docID]
    if !ok {
        return TreeOutline{}, ErrDocNotFound
    }
    return cloneOutline(doc.Tree), nil // deep copy, not shared memory
}
```

The `cloneOutline` helper is a package-private function that walks
the tree and allocates new `TreeNode` / `OutlineNode` values; the
returned `TreeOutline` shares no slices with `doc.Tree`.

### P5 — Race-test skeleton

```go
func TestStoreRace(t *testing.T) {
    if !race.Enabled {
        t.Skip("requires -race")
    }
    store := newTestStore(t)
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    var wg sync.WaitGroup
    for i := 0; i < 16; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for ctx.Err() == nil {
                _ = store.Search("kubernetes", SearchOptions{Limit: 5})
                _ = store.ListDocuments(ListOptions{})
                _, _ = store.GetTree("docs/runbook/auth")
            }
        }()
    }
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; ctx.Err() == nil; i++ {
            _ = store.AddDocument(syntheticDoc(i))
        }
    }()
    wg.Wait()
}
```

(Illustrative. The actual test lives in `tests/go/store_race_test.go`
and uses the fixture corpus for the background data.)

## Concurrency

This entire spec *is* the concurrency chapter; other specs
reference it rather than duplicate it. In particular:

- `docs/spec/bm25-engine.md` defers to R2 for which method takes
  which lock.
- `docs/spec/curator.md` defers to R7 for "the curator is the only
  production writer".
- `docs/spec/mcp-server.md` defers to R9 for handler setup.
- `docs/spec/incremental-index.md` defers to R4 for the snapshot
  rule on facet-value returns.

## Fixture data

N/A — this is a behavioral spec. The race-test fixture is a
small synthetic corpus defined inline in
`tests/go/store_race_test.go`; no JSON fixture is dumped from the
TS oracle because TS has no concurrency to mirror.
