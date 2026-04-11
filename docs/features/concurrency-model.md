# Concurrency model

## Summary

This document is the authoritative source on thread-safety for the
entire Go port. Every other spec that mentions a lock, a goroutine,
or a shared data structure references back to the rules here.

Bun's stdio transport is effectively single-threaded — an incoming
MCP request is handled to completion before the next one starts, and
the JavaScript event loop gives the TS `DocumentStore` a free pass on
locking. Go has no such luxury. `github.com/mark3labs/mcp-go` may
dispatch tool calls on separate goroutines, and the HTTP transport
certainly does. The moment two goroutines can reach
`store.Search` while a third is running `store.AddDocument` from the
curator write path, the index needs real locking or the race detector
will find the first corrupted map in CI.

The rule for the port: `internal/store` is guarded by a single
`sync.RWMutex`. Readers take the read lock; writers take the write
lock. Everything else flows from that one invariant — and every PR
runs `go test -race` so the invariant stays honest.

## Go package

`internal/store` owns the lock. Every other package is a client:
`internal/indexer`, `internal/curator`, and `internal/mcp` call into
the store and must never be called back into by the store.

## Public API (Go signatures) — N/A

This is an architectural doc. See `docs/spec/concurrency-model.md`
for the rules per operation and `docs/spec/bm25-engine.md` for the
actual `DocumentStore` method set those rules apply to.

## Key behaviors

### One mutex, one owner

`DocumentStore` holds exactly one `sync.RWMutex`. It is not
embedded and it is not exported. Every exported method on
`DocumentStore` either acquires the read lock or the write lock at
function entry and releases it at function exit via `defer`. No
method returns with the lock held. No method takes any other lock
while holding this one, because there are no other locks.

### Read vs. write split

Reads take `RLock()`:

- `Search`
- `ListDocuments`
- `GetTree`
- `GetNodeContent`
- `NavigateTree`
- `ResolveRef`
- `GetDocMeta`
- `GetGlossaryTerms`
- `GetStats`
- `FindSymbol`

Writes take `Lock()`:

- `Load` (bulk replace)
- `AddDocument` (incremental upsert from the curator)
- `LoadGlossary`
- `SetCollectionWeight`

The split matters because curator writes are rare (a user writing a
new wiki entry every few minutes at most) while reads are the entire
hot path. `sync.RWMutex` lets N concurrent readers proceed in
parallel and only blocks them when an `AddDocument` actually needs
to mutate the postings list.

### Snapshot-for-iteration

Any method that returns a slice or a map drawn from the store's
internal state copies that data under the read lock before returning.
The caller iterates over the copy and never touches the real index.

Concrete cases:

- `ListDocuments` copies `DocumentMeta` values, not pointers.
- `GetGlossaryTerms` returns a freshly allocated `[]string`.
- `GetStats` returns a struct by value.
- `Search` builds its `[]SearchResult` during the read lock and
  returns that pre-built slice.
- `GetTree` and `NavigateTree` copy the `TreeNode` subtree they
  return, because the underlying nodes may be rebuilt on the next
  `AddDocument`.

The snapshot copy is cheap (node counts are in the thousands, not
the millions) and removes an entire class of "iterator invalidated
by concurrent writer" bugs.

### Deadlock avoidance

The store calls **nothing** while holding its lock. That's the
entire policy. Concretely:

- The store does not call into `internal/curator`.
- The store does not call into `internal/indexer`.
- The store does not start goroutines from inside a locked region.
- The store does not read from an unbuffered channel from inside a
  locked region.
- The store does not call user-supplied callbacks (there are none
  on the current API).

Layering is one-directional: `curator` calls `store.AddDocument`;
`indexer` produces `IndexedDocument` values that `store.Load`
consumes. Neither package is called back into by the store, so the
store can never re-enter itself via an indirect path.

### Startup indexing is lock-free

The initial bulk index runs in `cmd/treenav-mcp/main.go` before the
MCP transport is connected. At that point no request handler exists,
no goroutine other than `main` can reach the store, and the race
detector cannot observe a conflict. `Load` therefore takes the
write lock out of discipline (so it's fine to call from tests or
from a future hot-reload path) but during normal startup the lock
is uncontended and effectively free.

Only the post-startup path — the curator's `AddDocument` after the
server is already serving — exercises the lock in anger.

### `go test -race` is a CI requirement

Every PR to this branch runs `go test -race ./...` in CI. A race
reported against the store is a release blocker, not a flake. The
adversarial test suite in `tests/go/store_race_test.go` spins up N
reader goroutines plus one writer goroutine and lets the race
detector sweep the full operation matrix for a fixed duration.
That test must pass before Phase C closes.

### Read-only data is lock-free

Some state inside the store never mutates after `Load` / `AddDocument`
and can be read without the mutex. This is an optimization the
spec permits but does not require:

- `rankingParams` — set once at construction, never changed.
- Sentinel error values — package-level `var`.
- Collection-weight defaults.

Every mutating field (`docs`, `index`, `filters`, `nodeStats`,
`contentHashes`, `glossary`, `refMap`, `totalNodes`, `avgNodeLength`)
is protected by the lock without exception.

## Dependencies

- **stdlib only:** `sync`, `context`.
- **No third-party concurrency primitives.** No `errgroup`, no
  `semaphore`, no `atomic.Value` tricks. One `sync.RWMutex` covers
  every case the current workload needs.

## Relationship to TS source

- Replaces zero locking in `src/store.ts`. The TS version is
  implicitly single-threaded courtesy of Bun's event loop and gets
  away with mutable `Map<string, Posting[]>` structures because only
  one callback at a time ever touches them.
- The TS curator (`src/curator.ts`) calls `store.addDocument()` at
  line 416 with no lock — in TS that's a non-issue, in Go the same
  call path must go through the write lock.
- The HTTP variant at `src/server-http.ts:70` creates a new
  `McpServer` per request but shares the same `DocumentStore` across
  requests, so the TS code already has a multi-reader shape — it
  just happens to be safe because each request runs to completion
  before the event loop picks up the next one. Go's HTTP server
  gives no such guarantee.

## Non-goals

- **Per-field locking or sharded maps.** Not needed; the contention
  is negligible for this workload.
- **Lock-free data structures.** A `sync.Map` or a custom
  copy-on-write index would be a premature optimization. The
  profile does not justify the complexity.
- **Cancellation via `context.Context` on reads.** Queries are
  sub-millisecond; cancellation is not useful and adds noise. The
  MCP layer may pass a context for HTTP timeout enforcement, but
  `DocumentStore` methods ignore it.
- **Write batching.** `AddDocument` is called per file by the
  curator; there is no bulk-write API beyond `Load`. A future
  bulk-upsert method is out of scope for Phase C.

### Future: copy-on-write index

If the workload ever shifts to write-heavy — a live-reload mode,
for example, where every filesystem change triggers an
`AddDocument` — the right upgrade path is a copy-on-write index.
The store would hold an `atomic.Pointer[indexSnapshot]`; readers
would load the current snapshot without a lock; writers would
build a new snapshot from the old one and atomically swap it in.
`sync.RWMutex` remains the default because writes are rare and
reads are cheap, and because the copy-on-write path pays an O(N)
allocation cost per write that is wasted on the current traffic
shape. Mentioned here for the record so the next person to look
at the concurrency model does not re-derive the decision.
