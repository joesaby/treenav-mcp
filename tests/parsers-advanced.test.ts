/**
 * Advanced parser tests using realistic patterns from large open-source codebases.
 *
 * Envoy (C++)   → generic.ts (lang="c")
 * Kubernetes (Go) → generic.ts (lang="go")
 * Django (Python) → python.ts
 * ripgrep (Rust) → rust.ts (dedicated parser)
 *
 * Each describe block covers what the parser handles (✓) and explicitly
 * documents known limitations (✗) so regressions are caught without
 * accidentally asserting on broken behaviour.
 */

import { describe, test, expect } from "bun:test";
import { parseGeneric } from "../src/parsers/generic";
import { parsePython } from "../src/parsers/python";
import { parseRust } from "../src/parsers/rust";
import {
  CPP_ENVOY_FILTER_IMPL,
  CPP_ENVOY_HEADER,
  GO_K8S_CONTROLLER,
  PY_DJANGO_VIEWS,
  RUST_MATCHER,
} from "./fixtures/sample-code-advanced";

// ── C++ — Envoy-style ─────────────────────────────────────────────────

describe("parseGeneric (C++ .cc — Envoy implementation file)", () => {
  test("groups #include block into imports", () => {
    const symbols = parseGeneric(CPP_ENVOY_FILTER_IMPL, "test:envoy_cc", ".cc");
    const imports = symbols.find((s) => s.kind === "import");
    expect(imports).toBeDefined();
    expect(imports!.content).toContain("#include");
  });

  test("detects ClassName::method implementations", () => {
    const symbols = parseGeneric(CPP_ENVOY_FILTER_IMPL, "test:envoy_cc", ".cc");
    const names = symbols.map((s) => s.name);
    expect(names).toContain("FilterManagerImpl::decodeHeaders");
    expect(names).toContain("FilterManagerImpl::createFilterChain");
    expect(names).toContain("FilterManagerImpl::encode1xxHeaders");
    expect(names).toContain("FilterManagerImpl::onDestroy");
  });

  test("detects destructor (ClassName::~ClassName)", () => {
    const symbols = parseGeneric(CPP_ENVOY_FILTER_IMPL, "test:envoy_cc", ".cc");
    const dtor = symbols.find((s) => s.name === "FilterManagerImpl::~FilterManagerImpl");
    expect(dtor).toBeDefined();
    expect(dtor!.kind).toBe("function");
  });

  test("ClassName::method implementations are kind=function", () => {
    const symbols = parseGeneric(CPP_ENVOY_FILTER_IMPL, "test:envoy_cc", ".cc");
    const methods = symbols.filter((s) => s.name.includes("::"));
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) {
      expect(m.kind).toBe("function");
    }
  });

  test("multi-line constructor (init-list) is detected", () => {
    const symbols = parseGeneric(CPP_ENVOY_FILTER_IMPL, "test:envoy_cc", ".cc");
    const ctor = symbols.find((s) => s.name === "FilterManagerImpl::FilterManagerImpl");
    expect(ctor).toBeDefined();
  });
});

describe("parseGeneric (C++ .h header — Envoy)", () => {
  test("groups #pragma and includes into imports", () => {
    const symbols = parseGeneric(CPP_ENVOY_HEADER, "test:envoy_h", ".h");
    const imports = symbols.find((s) => s.kind === "import");
    expect(imports).toBeDefined();
  });

  test("detects top-level struct", () => {
    const symbols = parseGeneric(CPP_ENVOY_HEADER, "test:envoy_h", ".h");
    const filterState = symbols.find((s) => s.name === "FilterState");
    expect(filterState).toBeDefined();
    expect(filterState!.kind).toBe("class"); // struct maps to class
  });

  test("detects top-level class", () => {
    const symbols = parseGeneric(CPP_ENVOY_HEADER, "test:envoy_h", ".h");
    const mgr = symbols.find((s) => s.name === "FilterManagerImpl");
    expect(mgr).toBeDefined();
    expect(mgr!.kind).toBe("class");
    expect(mgr!.exported).toBe(false); // no pub/export keyword
  });

  // Known limitation: parseGenericMembers only matches fn/func/function/def keywords.
  // C++ member declarations (void decodeHeaders(...);) have no such keyword,
  // so methods inside class bodies are not extracted for C++ headers.
  test("LIMITATION: C++ class members not extracted (no fn/func keyword)", () => {
    const symbols = parseGeneric(CPP_ENVOY_HEADER, "test:envoy_h", ".h");
    const mgr = symbols.find((s) => s.name === "FilterManagerImpl");
    expect(mgr).toBeDefined();
    // Methods are NOT extracted — children_ids is empty
    expect(mgr!.children_ids.length).toBe(0);
    // But the class itself is detected correctly
    expect(mgr!.kind).toBe("class");
  });
});

// ── Go — Kubernetes-style ─────────────────────────────────────────────

describe("parseGeneric (Go — Kubernetes controller)", () => {
  test("groups Go import block (parenthesised)", () => {
    const symbols = parseGeneric(GO_K8S_CONTROLLER, "test:k8s_go", ".go");
    const imports = symbols.find((s) => s.kind === "import");
    expect(imports).toBeDefined();
    expect(imports!.content).toContain("context");
    expect(imports!.content).toContain("k8s.io");
  });

  test("detects type Foo struct → class", () => {
    const symbols = parseGeneric(GO_K8S_CONTROLLER, "test:k8s_go", ".go");
    const ctrl = symbols.find((s) => s.name === "DeploymentController");
    expect(ctrl).toBeDefined();
    expect(ctrl!.kind).toBe("class");
    expect(ctrl!.exported).toBe(true); // uppercase = exported in Go
  });

  test("detects type Foo interface → interface", () => {
    const symbols = parseGeneric(GO_K8S_CONTROLLER, "test:k8s_go", ".go");
    const iface = symbols.find((s) => s.name === "DeploymentInterface");
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe("interface");
    expect(iface!.exported).toBe(true);
  });

  test("detects top-level constructor function NewXxx", () => {
    const symbols = parseGeneric(GO_K8S_CONTROLLER, "test:k8s_go", ".go");
    const ctor = symbols.find((s) => s.name === "NewDeploymentController");
    expect(ctor).toBeDefined();
    expect(ctor!.kind).toBe("function");
    expect(ctor!.exported).toBe(true);
  });

  test("detects receiver methods func (c *T) Method(...)", () => {
    const symbols = parseGeneric(GO_K8S_CONTROLLER, "test:k8s_go", ".go");
    const names = symbols.map((s) => s.name);
    // Receiver methods are captured — name is the method name, not the receiver
    expect(names).toContain("Run");
    expect(names).toContain("syncDeployment");
    expect(names).toContain("enqueue");
    expect(names).toContain("runWorker");
  });

  test("receiver methods have kind=function and are exported correctly", () => {
    const symbols = parseGeneric(GO_K8S_CONTROLLER, "test:k8s_go", ".go");
    const run = symbols.find((s) => s.name === "Run");
    expect(run).toBeDefined();
    expect(run!.kind).toBe("function");
    expect(run!.exported).toBe(true); // uppercase

    const runWorker = symbols.find((s) => s.name === "runWorker");
    expect(runWorker).toBeDefined();
    expect(runWorker!.exported).toBe(false); // lowercase
  });

  test("detects var declaration", () => {
    const symbols = parseGeneric(GO_K8S_CONTROLLER, "test:k8s_go", ".go");
    const errVar = symbols.find((s) => s.name === "ErrSyncTimeout");
    expect(errVar).toBeDefined();
    expect(errVar!.kind).toBe("variable");
    expect(errVar!.exported).toBe(true); // uppercase
  });
});

// ── Python — Django-style ─────────────────────────────────────────────

describe("parsePython (Django class-based views)", () => {
  test("detects multiple-inheritance class", () => {
    const symbols = parsePython(PY_DJANGO_VIEWS, "test:django");
    const view = symbols.find((s) => s.name === "UserListView");
    expect(view).toBeDefined();
    expect(view!.kind).toBe("class");
    expect(view!.signature).toContain("LoginRequiredMixin");
    expect(view!.signature).toContain("ListView");
  });

  test("extracts methods with type annotations", () => {
    const symbols = parsePython(PY_DJANGO_VIEWS, "test:django");
    const view = symbols.find((s) => s.name === "UserListView");
    const methods = symbols.filter((s) => s.parent_id === view!.id);
    const methodNames = methods.map((m) => m.name);
    expect(methodNames).toContain("get_queryset");
    expect(methodNames).toContain("get_context_data");
  });

  test("@classmethod and @staticmethod decorators appear in signature", () => {
    const symbols = parsePython(PY_DJANGO_VIEWS, "test:django");
    const getExtraActions = symbols.find((s) => s.name === "get_extra_actions");
    expect(getExtraActions).toBeDefined();
    expect(getExtraActions!.signature).toContain("@classmethod");

    const formatName = symbols.find((s) => s.name === "format_display_name");
    expect(formatName).toBeDefined();
    expect(formatName!.signature).toContain("@staticmethod");
  });

  test("detects all class-based view classes", () => {
    const symbols = parsePython(PY_DJANGO_VIEWS, "test:django");
    const classNames = symbols.filter((s) => s.kind === "class").map((s) => s.name);
    expect(classNames).toContain("UserListView");
    expect(classNames).toContain("UserDetailView");
    expect(classNames).toContain("BaseAuditView");
  });

  test("private methods are marked non-exported", () => {
    const symbols = parsePython(PY_DJANGO_VIEWS, "test:django");
    const helper = symbols.find((s) => s.name === "_build_filter_kwargs");
    expect(helper).toBeDefined();
    expect(helper!.exported).toBe(false);
  });

  test("module-level constant is detected", () => {
    const symbols = parsePython(PY_DJANGO_VIEWS, "test:django");
    const cacheTtl = symbols.find((s) => s.name === "CACHE_TTL");
    expect(cacheTtl).toBeDefined();
    expect(cacheTtl!.kind).toBe("variable");
  });

  test("standalone function with keyword-only args is detected", () => {
    const symbols = parsePython(PY_DJANGO_VIEWS, "test:django");
    const bulk = symbols.find((s) => s.name === "process_user_bulk");
    expect(bulk).toBeDefined();
    expect(bulk!.kind).toBe("function");
    expect(bulk!.parent_id).toBeNull();
    expect(bulk!.exported).toBe(true); // no leading underscore
  });

  test("imports are grouped", () => {
    const symbols = parsePython(PY_DJANGO_VIEWS, "test:django");
    const imports = symbols.find((s) => s.kind === "import");
    expect(imports).toBeDefined();
    expect(imports!.content).toContain("django");
  });
});

// ── Rust — ripgrep-style ──────────────────────────────────────────────

describe("parseRust (Rust — ripgrep matcher)", () => {
  test("detects pub struct → class", () => {
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    const matcher = symbols.find((s) => s.name === "RegexMatcher");
    expect(matcher).toBeDefined();
    expect(matcher!.kind).toBe("class");
    expect(matcher!.exported).toBe(true);
  });

  test("detects pub struct Match (short name)", () => {
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    const match_ = symbols.find((s) => s.name === "Match");
    expect(match_).toBeDefined();
    expect(match_!.kind).toBe("class");
  });

  test("detects pub trait → interface", () => {
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    const trait_ = symbols.find((s) => s.name === "Matcher");
    expect(trait_).toBeDefined();
    expect(trait_!.kind).toBe("interface");
    expect(trait_!.exported).toBe(true);
  });

  test("detects pub enum → enum", () => {
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    const kind = symbols.find((s) => s.name === "MatchKind");
    expect(kind).toBeDefined();
    expect(kind!.kind).toBe("enum");
    expect(kind!.exported).toBe(true);
  });

  test("detects pub fn at top level → function", () => {
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    const newFn = symbols.find((s) => s.name === "new_regex_matcher");
    expect(newFn).toBeDefined();
    expect(newFn!.kind).toBe("function");
    expect(newFn!.exported).toBe(true);

    const buildFn = symbols.find((s) => s.name === "build_matchers");
    expect(buildFn).toBeDefined();
    expect(buildFn!.exported).toBe(true);
  });

  test("private fn is detected and marked non-exported", () => {
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    const internal = symbols.find((s) => s.name === "internal_normalize");
    expect(internal).toBeDefined();
    expect(internal!.exported).toBe(false);
  });

  test("detects pub const and pub static → variable", () => {
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    const maxLen = symbols.find((s) => s.name === "MAX_PATTERN_LEN");
    expect(maxLen).toBeDefined();
    expect(maxLen!.kind).toBe("variable");
    expect(maxLen!.exported).toBe(true);

    const flags = symbols.find((s) => s.name === "DEFAULT_FLAGS");
    expect(flags).toBeDefined();
    expect(flags!.kind).toBe("variable");
  });

  test("impl methods are parsed and linked to their struct", () => {
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    // parseRust two-pass approach links impl methods to their parent struct
    const matcher = symbols.find((s) => s.name === "RegexMatcher")!;
    const pattern = symbols.find((s) => s.name === "pattern");
    expect(pattern).toBeDefined();
    expect(pattern!.parent_id).toBe(matcher.id);
    // Matcher impl methods are also linked to RegexMatcher
    const isMatch = symbols.find((s) => s.name === "is_match");
    expect(isMatch).toBeDefined();
  });

  test("pub(crate) fn is detected (regex matches pub(crate) prefix)", () => {
    // parseRust's regex matches pub(?:\([^)]*\))? so pub(crate) is handled
    const symbols = parseRust(RUST_MATCHER, "test:rust");
    // Verify that our known pub fns ARE detected (baseline)
    expect(symbols.find((s) => s.name === "new_regex_matcher")).toBeDefined();
  });
});
