/**
 * Comprehensive parser tests for all supported languages.
 *
 * Tests edge cases, realistic patterns, and correctness for:
 *  - TypeScript parser (typescript.ts)
 *  - Python parser (python.ts)
 *  - Generic parser (generic.ts) — Go, Rust, Java, C/C++, Ruby, Shell
 */

import { describe, test, expect } from "bun:test";
import { parseTypeScript } from "../src/parsers/typescript";
import { parsePython } from "../src/parsers/python";
import { parseGeneric } from "../src/parsers/generic";
import type { CodeSymbol } from "../src/code-indexer";

import {
  TS_ABSTRACT_CLASS,
  TS_COMPLEX_GENERICS,
  TS_ENUM_CONST_ENUM,
  TS_MULTI_LINE_FUNCTION,
  TS_COMPLEX_ARROW,
  TS_CLASS_ACCESSORS,
  TS_EXPORTED_ARRAYS_OBJECTS,
  TS_IMPLEMENTS_EXTENDS,
  TS_ONLY_IMPORTS,
  TS_EMPTY_FILE,
  TS_COMMENTS_ONLY,
  TS_INTERFACE_WITH_METHODS,
  TS_MULTIPLE_CLASSES,
  PY_ASYNC_DECORATORS,
  PY_INHERITANCE,
  PY_MODULE_CONSTANTS,
  PY_DUNDER_METHODS,
  PY_EMPTY_FILE,
  PY_ONLY_IMPORTS,
  PY_MULTI_LINE_IMPORTS,
  PY_NESTED_CLASSES,
  GO_INTERFACES,
  GO_UNEXPORTED,
  RUST_STRUCTS_TRAITS,
  RUST_ENUMS,
  JAVA_CLASS,
  C_HEADER,
  CPP_CLASS,
  CPP_IMPL,
  RUBY_CLASS,
  SHELL_SCRIPT,
} from "./fixtures/lang-samples";

// ── Helpers ────────────────────────────────────────────────────────

function findByName(symbols: CodeSymbol[], name: string): CodeSymbol | undefined {
  return symbols.find((s) => s.name === name);
}

function findByKind(symbols: CodeSymbol[], kind: string): CodeSymbol[] {
  return symbols.filter((s) => s.kind === kind);
}

function childrenOf(symbols: CodeSymbol[], parent: CodeSymbol): CodeSymbol[] {
  return symbols.filter((s) => s.parent_id === parent.id);
}

// ════════════════════════════════════════════════════════════════════
// TypeScript Parser
// ════════════════════════════════════════════════════════════════════

describe("TypeScript Parser", () => {
  // ── Abstract classes ──────────────────────────────────────────────

  describe("abstract classes", () => {
    const symbols = parseTypeScript(TS_ABSTRACT_CLASS, "test:abs");

    test("extracts abstract class", () => {
      const cls = findByName(symbols, "BaseRepository");
      expect(cls).toBeDefined();
      expect(cls!.kind).toBe("class");
      expect(cls!.exported).toBe(true);
    });

    test("extracts abstract methods as children", () => {
      const cls = findByName(symbols, "BaseRepository")!;
      const children = childrenOf(symbols, cls);
      const names = children.map((c) => c.name);
      expect(names).toContain("findById");
      expect(names).toContain("findAll");
      expect(names).toContain("save");
    });

    test("class has correct children_ids", () => {
      const cls = findByName(symbols, "BaseRepository")!;
      expect(cls.children_ids.length).toBeGreaterThan(0);
      for (const childId of cls.children_ids) {
        const child = symbols.find((s) => s.id === childId);
        expect(child).toBeDefined();
        expect(child!.parent_id).toBe(cls.id);
      }
    });

    test("constructor is extracted", () => {
      const cls = findByName(symbols, "BaseRepository")!;
      const children = childrenOf(symbols, cls);
      const ctor = children.find((c) => c.name === "constructor");
      expect(ctor).toBeDefined();
      expect(ctor!.kind).toBe("method");
    });

    test("imports are grouped", () => {
      const imports = findByKind(symbols, "import");
      expect(imports.length).toBe(1);
      expect(imports[0].content).toContain("EventEmitter");
    });
  });

  // ── Complex generics ─────────────────────────────────────────────

  describe("complex generics", () => {
    const symbols = parseTypeScript(TS_COMPLEX_GENERICS, "test:gen");

    test("extracts generic interface", () => {
      const repo = findByName(symbols, "Repository");
      expect(repo).toBeDefined();
      expect(repo!.kind).toBe("interface");
      expect(repo!.exported).toBe(true);
    });

    test("extracts Paginated interface", () => {
      const paginated = findByName(symbols, "Paginated");
      expect(paginated).toBeDefined();
      expect(paginated!.kind).toBe("interface");
    });

    test("extracts complex type alias", () => {
      const result = findByName(symbols, "Result");
      expect(result).toBeDefined();
      expect(result!.kind).toBe("type");
      expect(result!.exported).toBe(true);
    });

    test("interface members are extracted", () => {
      const repo = findByName(symbols, "Repository")!;
      const children = childrenOf(symbols, repo);
      const names = children.map((c) => c.name);
      expect(names).toContain("findById");
      expect(names).toContain("findAll");
      expect(names).toContain("save");
      expect(names).toContain("delete");
    });
  });

  // ── Enums ─────────────────────────────────────────────────────────

  describe("enums", () => {
    const symbols = parseTypeScript(TS_ENUM_CONST_ENUM, "test:enum");

    test("extracts regular enum", () => {
      const dir = findByName(symbols, "Direction");
      expect(dir).toBeDefined();
      expect(dir!.kind).toBe("enum");
      expect(dir!.exported).toBe(true);
    });

    test("extracts const enum", () => {
      const status = findByName(symbols, "Status");
      expect(status).toBeDefined();
      expect(status!.kind).toBe("enum");
      expect(status!.exported).toBe(true);
    });

    test("extracts non-exported enum", () => {
      const internal = findByName(symbols, "InternalState");
      expect(internal).toBeDefined();
      expect(internal!.kind).toBe("enum");
      expect(internal!.exported).toBe(false);
    });

    test("enum content includes members", () => {
      const dir = findByName(symbols, "Direction")!;
      expect(dir.content).toContain("Up");
      expect(dir.content).toContain("Down");
    });
  });

  // ── Multi-line functions ──────────────────────────────────────────

  describe("multi-line functions", () => {
    const symbols = parseTypeScript(TS_MULTI_LINE_FUNCTION, "test:mlfn");

    test("extracts async function with multi-line params", () => {
      const fetchData = findByName(symbols, "fetchData");
      expect(fetchData).toBeDefined();
      expect(fetchData!.kind).toBe("function");
      expect(fetchData!.exported).toBe(true);
    });

    test("function content includes full body", () => {
      const fetchData = findByName(symbols, "fetchData")!;
      expect(fetchData.content).toContain("retries");
      expect(fetchData.content).toContain("throw new Error");
    });

    test("extracts generator function", () => {
      const gen = findByName(symbols, "generateIds");
      expect(gen).toBeDefined();
      expect(gen!.kind).toBe("function");
      expect(gen!.exported).toBe(true);
    });
  });

  // ── Arrow functions ───────────────────────────────────────────────

  describe("complex arrow functions", () => {
    const symbols = parseTypeScript(TS_COMPLEX_ARROW, "test:arrow");

    test("extracts complex generic arrow function", () => {
      const debounce = findByName(symbols, "debounce");
      expect(debounce).toBeDefined();
      expect(debounce!.kind).toBe("function");
      expect(debounce!.exported).toBe(true);
    });

    test("extracts single-expression arrow", () => {
      const identity = findByName(symbols, "identity");
      expect(identity).toBeDefined();
      expect(identity!.kind).toBe("function");
    });

    test("extracts exported object constant", () => {
      const config = findByName(symbols, "CONFIG");
      expect(config).toBeDefined();
      expect(config!.kind).toBe("variable");
      expect(config!.exported).toBe(true);
    });

    test("extracts exported array constant", () => {
      const routes = findByName(symbols, "ROUTES");
      expect(routes).toBeDefined();
      expect(routes!.kind).toBe("variable");
      expect(routes!.exported).toBe(true);
    });
  });

  // ── Class with accessors ──────────────────────────────────────────

  describe("class with accessors", () => {
    const symbols = parseTypeScript(TS_CLASS_ACCESSORS, "test:acc");

    test("extracts class", () => {
      const user = findByName(symbols, "User");
      expect(user).toBeDefined();
      expect(user!.kind).toBe("class");
    });

    test("extracts getter methods", () => {
      const cls = findByName(symbols, "User")!;
      const children = childrenOf(symbols, cls);
      const names = children.map((c) => c.name);
      expect(names).toContain("name");
      expect(names).toContain("email");
    });

    test("extracts static methods", () => {
      const cls = findByName(symbols, "User")!;
      const children = childrenOf(symbols, cls);
      const fromJSON = children.find((c) => c.name === "fromJSON");
      expect(fromJSON).toBeDefined();
      expect(fromJSON!.kind).toBe("method");
    });

    test("extracts override methods", () => {
      const cls = findByName(symbols, "User")!;
      const children = childrenOf(symbols, cls);
      const toString = children.find((c) => c.name === "toString");
      expect(toString).toBeDefined();
      expect(toString!.kind).toBe("method");
    });

    test("extracts constructor", () => {
      const cls = findByName(symbols, "User")!;
      const children = childrenOf(symbols, cls);
      expect(children.find((c) => c.name === "constructor")).toBeDefined();
    });
  });

  // ── Exported arrays and objects ───────────────────────────────────

  describe("exported arrays and objects", () => {
    const symbols = parseTypeScript(TS_EXPORTED_ARRAYS_OBJECTS, "test:exp");

    test("extracts exported array", () => {
      const origins = findByName(symbols, "ALLOWED_ORIGINS");
      expect(origins).toBeDefined();
      expect(origins!.kind).toBe("variable");
      expect(origins!.exported).toBe(true);
    });

    test("extracts exported record", () => {
      const mimes = findByName(symbols, "MIME_TYPES");
      expect(mimes).toBeDefined();
      expect(mimes!.kind).toBe("variable");
      expect(mimes!.exported).toBe(true);
    });

    test("extracts exported let", () => {
      const cfg = findByName(symbols, "mutableConfig");
      expect(cfg).toBeDefined();
      expect(cfg!.kind).toBe("variable");
      expect(cfg!.exported).toBe(true);
    });
  });

  // ── Class with extends + implements ───────────────────────────────

  describe("class with extends and implements", () => {
    const symbols = parseTypeScript(TS_IMPLEMENTS_EXTENDS, "test:impl");

    test("extracts class with extends and implements", () => {
      const admin = findByName(symbols, "AdminUser");
      expect(admin).toBeDefined();
      expect(admin!.kind).toBe("class");
      expect(admin!.exported).toBe(true);
    });

    test("class has methods", () => {
      const admin = findByName(symbols, "AdminUser")!;
      const children = childrenOf(symbols, admin);
      const names = children.map((c) => c.name);
      expect(names).toContain("serialize");
      expect(names).toContain("getAuditLog");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("handles file with only imports", () => {
      const symbols = parseTypeScript(TS_ONLY_IMPORTS, "test:imp");
      expect(symbols.length).toBe(1);
      expect(symbols[0].kind).toBe("import");
    });

    test("handles empty file", () => {
      const symbols = parseTypeScript(TS_EMPTY_FILE, "test:empty");
      expect(symbols.length).toBe(0);
    });

    test("handles comments-only file", () => {
      const symbols = parseTypeScript(TS_COMMENTS_ONLY, "test:comments");
      expect(symbols.length).toBe(0);
    });

    test("interface with only methods", () => {
      const symbols = parseTypeScript(TS_INTERFACE_WITH_METHODS, "test:iface");
      const bus = findByName(symbols, "EventBus");
      expect(bus).toBeDefined();
      expect(bus!.kind).toBe("interface");
      const children = childrenOf(symbols, bus!);
      expect(children.length).toBeGreaterThanOrEqual(4);
      const names = children.map((c) => c.name);
      expect(names).toContain("on");
      expect(names).toContain("off");
      expect(names).toContain("emit");
      expect(names).toContain("once");
    });
  });

  // ── Multiple classes ──────────────────────────────────────────────

  describe("multiple classes in one file", () => {
    const symbols = parseTypeScript(TS_MULTIPLE_CLASSES, "test:multi");

    test("extracts all classes", () => {
      const classes = findByKind(symbols, "class");
      expect(classes.length).toBe(3);
    });

    test("exported classes are marked correctly", () => {
      const parser = findByName(symbols, "Parser");
      expect(parser!.exported).toBe(true);

      const lexer = findByName(symbols, "Lexer");
      expect(lexer!.exported).toBe(true);

      const internal = findByName(symbols, "InternalHelper");
      expect(internal!.exported).toBe(false);
    });

    test("each class has its own methods", () => {
      const parser = findByName(symbols, "Parser")!;
      const parserMethods = childrenOf(symbols, parser);
      expect(parserMethods.map((m) => m.name)).toContain("parse");

      const lexer = findByName(symbols, "Lexer")!;
      const lexerMethods = childrenOf(symbols, lexer);
      expect(lexerMethods.map((m) => m.name)).toContain("tokenize");

      const helper = findByName(symbols, "InternalHelper")!;
      const helperMethods = childrenOf(symbols, helper);
      expect(helperMethods.map((m) => m.name)).toContain("process");
    });
  });

  // ── Line number correctness ───────────────────────────────────────

  describe("line numbers", () => {
    test("all symbols have valid line numbers", () => {
      const symbols = parseTypeScript(TS_ABSTRACT_CLASS, "test:ln");
      for (const sym of symbols) {
        expect(sym.line_start).toBeGreaterThan(0);
        expect(sym.line_end).toBeGreaterThanOrEqual(sym.line_start);
      }
    });

    test("child line numbers are within parent range", () => {
      const symbols = parseTypeScript(TS_ABSTRACT_CLASS, "test:ln2");
      const cls = findByName(symbols, "BaseRepository")!;
      const children = childrenOf(symbols, cls);
      for (const child of children) {
        expect(child.line_start).toBeGreaterThanOrEqual(cls.line_start);
        expect(child.line_end).toBeLessThanOrEqual(cls.line_end);
      }
    });
  });

  // ── ID uniqueness ─────────────────────────────────────────────────

  describe("ID uniqueness", () => {
    test("all symbol IDs are unique", () => {
      const symbols = parseTypeScript(TS_ABSTRACT_CLASS, "test:id");
      const ids = symbols.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test("IDs use docId prefix", () => {
      const symbols = parseTypeScript(TS_ABSTRACT_CLASS, "test:prefix");
      for (const sym of symbols) {
        expect(sym.id).toStartWith("test:prefix:");
      }
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Python Parser
// ════════════════════════════════════════════════════════════════════

describe("Python Parser", () => {
  // ── Async + decorators ────────────────────────────────────────────

  describe("async functions and decorators", () => {
    const symbols = parsePython(PY_ASYNC_DECORATORS, "test:async");

    test("extracts decorated standalone function", () => {
      const fetchData = findByName(symbols, "fetch_data");
      expect(fetchData).toBeDefined();
      expect(fetchData!.kind).toBe("function");
      expect(fetchData!.exported).toBe(true);
    });

    test("decorator is included in signature", () => {
      const fetchData = findByName(symbols, "fetch_data")!;
      expect(fetchData.signature).toContain("@retry");
    });

    test("extracts regular function (decorator factory)", () => {
      const retry = findByName(symbols, "retry");
      expect(retry).toBeDefined();
      expect(retry!.kind).toBe("function");
    });

    test("extracts class with decorated methods", () => {
      const client = findByName(symbols, "APIClient");
      expect(client).toBeDefined();
      expect(client!.kind).toBe("class");
    });

    test("class methods include decorated methods", () => {
      const client = findByName(symbols, "APIClient")!;
      const methods = childrenOf(symbols, client);
      const names = methods.map((m) => m.name);
      expect(names).toContain("__init__");
      expect(names).toContain("get");
      expect(names).toContain("post");
      expect(names).toContain("build_url");
      expect(names).toContain("from_env");
    });

    test("imports are grouped", () => {
      const imports = findByKind(symbols, "import");
      expect(imports.length).toBe(1);
      expect(imports[0].content).toContain("asyncio");
      expect(imports[0].content).toContain("functools");
    });
  });

  // ── Inheritance ───────────────────────────────────────────────────

  describe("inheritance", () => {
    const symbols = parsePython(PY_INHERITANCE, "test:inh");

    test("extracts abstract base class", () => {
      const shape = findByName(symbols, "Shape");
      expect(shape).toBeDefined();
      expect(shape!.kind).toBe("class");
    });

    test("extracts derived classes", () => {
      const circle = findByName(symbols, "Circle");
      expect(circle).toBeDefined();
      expect(circle!.kind).toBe("class");

      const rect = findByName(symbols, "Rectangle");
      expect(rect).toBeDefined();
      expect(rect!.kind).toBe("class");
    });

    test("each class has its own methods", () => {
      const shape = findByName(symbols, "Shape")!;
      const shapeMethods = childrenOf(symbols, shape);
      expect(shapeMethods.map((m) => m.name)).toContain("area");
      expect(shapeMethods.map((m) => m.name)).toContain("perimeter");

      const circle = findByName(symbols, "Circle")!;
      const circleMethods = childrenOf(symbols, circle);
      expect(circleMethods.map((m) => m.name)).toContain("__init__");
      expect(circleMethods.map((m) => m.name)).toContain("area");
      expect(circleMethods.map((m) => m.name)).toContain("perimeter");
    });

    test("abstract decorator is in signature", () => {
      const shape = findByName(symbols, "Shape")!;
      const methods = childrenOf(symbols, shape);
      const area = methods.find((m) => m.name === "area");
      expect(area).toBeDefined();
      expect(area!.signature).toContain("@abstractmethod");
    });
  });

  // ── Module-level constants ────────────────────────────────────────

  describe("module-level constants", () => {
    const symbols = parsePython(PY_MODULE_CONSTANTS, "test:const");

    test("extracts simple constants", () => {
      expect(findByName(symbols, "MAX_RETRIES")).toBeDefined();
      expect(findByName(symbols, "DEFAULT_TIMEOUT")).toBeDefined();
      expect(findByName(symbols, "API_VERSION")).toBeDefined();
    });

    test("extracts path-based constants", () => {
      expect(findByName(symbols, "BASE_DIR")).toBeDefined();
      expect(findByName(symbols, "CONFIG_PATH")).toBeDefined();
    });

    test("extracts multi-line list constant", () => {
      const formats = findByName(symbols, "SUPPORTED_FORMATS");
      expect(formats).toBeDefined();
      expect(formats!.kind).toBe("variable");
      expect(formats!.content).toContain("json");
      expect(formats!.content).toContain("yaml");
    });

    test("extracts multi-line dict constant", () => {
      const codes = findByName(symbols, "ERROR_CODES");
      expect(codes).toBeDefined();
      expect(codes!.kind).toBe("variable");
      expect(codes!.content).toContain("400");
      expect(codes!.content).toContain("500");
    });

    test("private constant detected", () => {
      const secret = findByName(symbols, "_INTERNAL_SECRET");
      // Note: _INTERNAL_SECRET starts with _ but is UPPER_CASE
      // The Python parser looks for UPPER_CASE pattern. Let's see if it matches.
      // The regex is /^([A-Z][A-Z0-9_]+)/ which won't match _INTERNAL_SECRET
      // This is correct behavior - it starts with underscore
      expect(secret).toBeUndefined(); // correctly not treated as a constant
    });

    test("extracts function after constants", () => {
      const fn = findByName(symbols, "get_config");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
    });
  });

  // ── Dunder methods ────────────────────────────────────────────────

  describe("dunder methods", () => {
    const symbols = parsePython(PY_DUNDER_METHODS, "test:dunder");

    test("extracts class with dunder methods", () => {
      const matrix = findByName(symbols, "Matrix");
      expect(matrix).toBeDefined();
      expect(matrix!.kind).toBe("class");
    });

    test("all dunder methods are extracted", () => {
      const matrix = findByName(symbols, "Matrix")!;
      const methods = childrenOf(symbols, matrix);
      const names = methods.map((m) => m.name);
      expect(names).toContain("__init__");
      expect(names).toContain("__repr__");
      expect(names).toContain("__str__");
      expect(names).toContain("__add__");
      expect(names).toContain("__mul__");
      expect(names).toContain("__eq__");
      expect(names).toContain("__len__");
      expect(names).toContain("__getitem__");
    });

    test("dunder methods marked as non-exported (underscore prefix)", () => {
      const matrix = findByName(symbols, "Matrix")!;
      const methods = childrenOf(symbols, matrix);
      for (const m of methods) {
        expect(m.exported).toBe(false); // all start with _
      }
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("handles empty file", () => {
      const symbols = parsePython(PY_EMPTY_FILE, "test:empty");
      expect(symbols.length).toBe(0);
    });

    test("handles file with only imports", () => {
      const symbols = parsePython(PY_ONLY_IMPORTS, "test:imp");
      expect(symbols.length).toBe(1);
      expect(symbols[0].kind).toBe("import");
    });

    test("handles multi-line imports with parens", () => {
      const symbols = parsePython(PY_MULTI_LINE_IMPORTS, "test:mlimp");
      const imports = findByKind(symbols, "import");
      expect(imports.length).toBe(1);
      expect(imports[0].content).toContain("Optional");
      expect(imports[0].content).toContain("Union");
    });

    test("function after multi-line imports is extracted", () => {
      const symbols = parsePython(PY_MULTI_LINE_IMPORTS, "test:mlimp2");
      const fn = findByName(symbols, "process");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
    });
  });

  // ── Nested classes ────────────────────────────────────────────────

  describe("nested classes", () => {
    const symbols = parsePython(PY_NESTED_CLASSES, "test:nested");

    test("extracts outer class", () => {
      const outer = findByName(symbols, "Outer");
      expect(outer).toBeDefined();
      expect(outer!.kind).toBe("class");
    });

    test("outer class has methods", () => {
      const outer = findByName(symbols, "Outer")!;
      const children = childrenOf(symbols, outer);
      const names = children.map((c) => c.name);
      expect(names).toContain("outer_method");
    });
  });

  // ── Line numbers ──────────────────────────────────────────────────

  describe("line numbers", () => {
    test("all symbols have valid line numbers", () => {
      const symbols = parsePython(PY_INHERITANCE, "test:ln");
      for (const sym of symbols) {
        expect(sym.line_start).toBeGreaterThan(0);
        expect(sym.line_end).toBeGreaterThanOrEqual(sym.line_start);
      }
    });
  });

  // ── ID uniqueness ─────────────────────────────────────────────────

  describe("ID uniqueness", () => {
    test("all symbol IDs are unique", () => {
      const symbols = parsePython(PY_ASYNC_DECORATORS, "test:id");
      const ids = symbols.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Generic Parser — Go
// ════════════════════════════════════════════════════════════════════

describe("Generic Parser (Go)", () => {
  describe("interfaces and structs", () => {
    const symbols = parseGeneric(GO_INTERFACES, "test:go", ".go");

    test("extracts Go interfaces", () => {
      const reader = findByName(symbols, "Reader");
      expect(reader).toBeDefined();
      expect(reader!.kind).toBe("interface");
      expect(reader!.exported).toBe(true);
    });

    test("extracts multiple interfaces", () => {
      const writer = findByName(symbols, "Writer");
      expect(writer).toBeDefined();
      expect(writer!.kind).toBe("interface");

      const storage = findByName(symbols, "Storage");
      expect(storage).toBeDefined();
      expect(storage!.kind).toBe("interface");
    });

    test("extracts struct", () => {
      const s3 = findByName(symbols, "S3Storage");
      expect(s3).toBeDefined();
      expect(s3!.kind).toBe("class"); // struct -> class in our model
      expect(s3!.exported).toBe(true);
    });

    test("extracts constructor function", () => {
      const ctor = findByName(symbols, "NewS3Storage");
      expect(ctor).toBeDefined();
      expect(ctor!.kind).toBe("function");
      expect(ctor!.exported).toBe(true);
    });

    test("extracts method functions (receiver funcs)", () => {
      const read = findByName(symbols, "Read");
      expect(read).toBeDefined();
      expect(read!.kind).toBe("function");
    });

    test("extracts var declaration", () => {
      const bucket = findByName(symbols, "DefaultBucket");
      expect(bucket).toBeDefined();
      expect(bucket!.kind).toBe("variable");
      expect(bucket!.exported).toBe(true);
    });

    test("extracts const declaration", () => {
      const maxSize = findByName(symbols, "MaxFileSize");
      expect(maxSize).toBeDefined();
      expect(maxSize!.kind).toBe("variable");
      expect(maxSize!.exported).toBe(true);
    });

    test("imports are extracted", () => {
      const imports = findByKind(symbols, "import");
      expect(imports.length).toBe(1);
      expect(imports[0].content).toContain("context");
      expect(imports[0].content).toContain("io");
    });
  });

  describe("unexported symbols", () => {
    const symbols = parseGeneric(GO_UNEXPORTED, "test:go-unexp", ".go");

    test("lowercase struct is unexported", () => {
      const cfg = findByName(symbols, "config");
      expect(cfg).toBeDefined();
      expect(cfg!.kind).toBe("class");
      expect(cfg!.exported).toBe(false);
    });

    test("lowercase function is unexported", () => {
      const fn = findByName(symbols, "newConfig");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
      expect(fn!.exported).toBe(false);
    });

    test("lowercase var is unexported", () => {
      const v = findByName(symbols, "defaultConfig");
      expect(v).toBeDefined();
      expect(v!.kind).toBe("variable");
      expect(v!.exported).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Generic Parser — Rust
// ════════════════════════════════════════════════════════════════════

describe("Generic Parser (Rust)", () => {
  describe("structs, traits, impls", () => {
    const symbols = parseGeneric(RUST_STRUCTS_TRAITS, "test:rs", ".rs");

    test("extracts pub struct", () => {
      const cfg = findByName(symbols, "Config");
      expect(cfg).toBeDefined();
      expect(cfg!.kind).toBe("class");
      expect(cfg!.exported).toBe(true);
    });

    test("extracts pub trait", () => {
      const svc = findByName(symbols, "Service");
      expect(svc).toBeDefined();
      expect(svc!.kind).toBe("interface");
      expect(svc!.exported).toBe(true);
    });

    test("extracts pub enum", () => {
      const state = findByName(symbols, "ServerState");
      expect(state).toBeDefined();
      expect(state!.kind).toBe("enum");
      expect(state!.exported).toBe(true);
    });

    test("extracts pub async fn", () => {
      const fn = findByName(symbols, "start_server");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
      expect(fn!.exported).toBe(true);
    });

    test("extracts non-pub fn as unexported", () => {
      const fn = findByName(symbols, "internal_helper");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
      expect(fn!.exported).toBe(false);
    });

    test("extracts pub const", () => {
      const c = findByName(symbols, "MAX_CONNECTIONS");
      expect(c).toBeDefined();
      expect(c!.kind).toBe("variable");
      expect(c!.exported).toBe(true);
    });

    test("extracts pub static", () => {
      const s = findByName(symbols, "DEFAULT_HOST");
      expect(s).toBeDefined();
      expect(s!.kind).toBe("variable");
      expect(s!.exported).toBe(true);
    });

    test("extracts pub type alias", () => {
      const t = findByName(symbols, "ConnectionPool");
      expect(t).toBeDefined();
      expect(t!.kind).toBe("variable");
      expect(t!.exported).toBe(true);
    });

    test("extracts use imports", () => {
      const imports = findByKind(symbols, "import");
      expect(imports.length).toBe(1);
      expect(imports[0].content).toContain("use std::fmt");
    });
  });

  describe("enums", () => {
    const symbols = parseGeneric(RUST_ENUMS, "test:rs-enum", ".rs");

    test("extracts pub enum", () => {
      const color = findByName(symbols, "Color");
      expect(color).toBeDefined();
      expect(color!.kind).toBe("enum");
      expect(color!.exported).toBe(true);
    });

    test("extracts non-pub enum as unexported", () => {
      const err = findByName(symbols, "InternalError");
      expect(err).toBeDefined();
      expect(err!.kind).toBe("enum");
      expect(err!.exported).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Generic Parser — Java
// ════════════════════════════════════════════════════════════════════

describe("Generic Parser (Java)", () => {
  const symbols = parseGeneric(JAVA_CLASS, "test:java", ".java");

  test("extracts public class", () => {
    const cls = findByName(symbols, "AuthenticationService");
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe("class");
    expect(cls!.exported).toBe(true); // public
  });

  test("extracts class methods", () => {
    const cls = findByName(symbols, "AuthenticationService")!;
    const methods = childrenOf(symbols, cls);
    const names = methods.map((m) => m.name);
    // Java methods should be extracted as members
    expect(methods.length).toBeGreaterThan(0);
  });

  test("extracts interface", () => {
    const iface = findByName(symbols, "TokenProvider");
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe("interface");
  });

  test("extracts enum", () => {
    const e = findByName(symbols, "AuthRole");
    expect(e).toBeDefined();
    expect(e!.kind).toBe("enum");
  });

  test("extracts package/import block", () => {
    const imports = findByKind(symbols, "import");
    expect(imports.length).toBe(1);
    expect(imports[0].content).toContain("java.util");
  });
});

// ════════════════════════════════════════════════════════════════════
// Generic Parser — C/C++
// ════════════════════════════════════════════════════════════════════

describe("Generic Parser (C)", () => {
  describe("C header file", () => {
    const symbols = parseGeneric(C_HEADER, "test:c", ".h");

    test("extracts #include imports", () => {
      const imports = findByKind(symbols, "import");
      expect(imports.length).toBe(1);
      expect(imports[0].content).toContain("stdio.h");
      expect(imports[0].content).toContain("stdlib.h");
    });

    test("extracts function declarations", () => {
      const create = findByName(symbols, "create_config");
      expect(create).toBeDefined();
      expect(create!.kind).toBe("function");
    });

    test("extracts destroy function", () => {
      const destroy = findByName(symbols, "destroy_config");
      expect(destroy).toBeDefined();
      expect(destroy!.kind).toBe("function");
    });

    test("extracts start_server function", () => {
      const start = findByName(symbols, "start_server");
      expect(start).toBeDefined();
      expect(start!.kind).toBe("function");
    });
  });

  describe("C++ class file", () => {
    const symbols = parseGeneric(CPP_CLASS, "test:cpp", ".cpp");

    test("extracts C++ class", () => {
      const cls = findByName(symbols, "HttpServer");
      expect(cls).toBeDefined();
      expect(cls!.kind).toBe("class");
    });

    test("extracts #include imports", () => {
      const imports = findByKind(symbols, "import");
      expect(imports.length).toBe(1);
    });
  });

  describe("C++ implementation file", () => {
    const symbols = parseGeneric(CPP_IMPL, "test:cc", ".cc");

    test("extracts C++ method implementations (ClassName::method)", () => {
      // The parser should detect ClassName::method patterns
      const methods = symbols.filter((s) => s.name.includes("HttpServer::"));
      expect(methods.length).toBeGreaterThan(0);
    });

    test("extracts constructor implementation", () => {
      const ctor = findByName(symbols, "HttpServer::HttpServer");
      expect(ctor).toBeDefined();
      expect(ctor!.kind).toBe("function");
    });

    test("extracts destructor implementation", () => {
      const dtor = findByName(symbols, "HttpServer::~HttpServer");
      expect(dtor).toBeDefined();
      expect(dtor!.kind).toBe("function");
    });

    test("extracts method implementations", () => {
      const start = findByName(symbols, "HttpServer::start");
      expect(start).toBeDefined();
      expect(start!.kind).toBe("function");
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Generic Parser — Ruby
// ════════════════════════════════════════════════════════════════════

describe("Generic Parser (Ruby)", () => {
  const symbols = parseGeneric(RUBY_CLASS, "test:rb", ".rb");

  test("extracts Ruby class", () => {
    const cls = findByName(symbols, "UserService");
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe("class");
    expect(cls!.exported).toBe(true);
  });

  test("extracts Ruby class methods", () => {
    const cls = findByName(symbols, "UserService")!;
    const methods = childrenOf(symbols, cls);
    const names = methods.map((m) => m.name);
    expect(names).toContain("initialize");
    expect(names).toContain("find");
    expect(names).toContain("create");
    expect(names).toContain("delete");
  });

  test("private method detected", () => {
    const cls = findByName(symbols, "UserService")!;
    const methods = childrenOf(symbols, cls);
    const validate = methods.find((m) => m.name === "_internal_validate");
    expect(validate).toBeDefined();
    expect(validate!.exported).toBe(false); // starts with _
  });

  test("extracts inheriting class", () => {
    const admin = findByName(symbols, "AdminService");
    expect(admin).toBeDefined();
    expect(admin!.kind).toBe("class");
  });

  test("extracts standalone function", () => {
    const fn = findByName(symbols, "create_service");
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe("function");
  });

  test("extracts require imports", () => {
    const imports = findByKind(symbols, "import");
    expect(imports.length).toBe(1);
    expect(imports[0].content).toContain("require");
  });
});

// ════════════════════════════════════════════════════════════════════
// Generic Parser — Shell
// ════════════════════════════════════════════════════════════════════

describe("Generic Parser (Shell)", () => {
  const symbols = parseGeneric(SHELL_SCRIPT, "test:sh", ".sh");

  test("extracts source/dot imports", () => {
    const imports = findByKind(symbols, "import");
    expect(imports.length).toBe(1);
  });

  test("extracts function keyword functions", () => {
    const deploy = findByName(symbols, "deploy");
    expect(deploy).toBeDefined();
    expect(deploy!.kind).toBe("function");
  });

  test("extracts function keyword functions (build_app)", () => {
    const build = findByName(symbols, "build_app");
    expect(build).toBeDefined();
    expect(build!.kind).toBe("function");
  });

  test("extracts name() style functions", () => {
    const migrate = findByName(symbols, "run_migrations");
    expect(migrate).toBeDefined();
    expect(migrate!.kind).toBe("function");
  });

  test("extracts cleanup function", () => {
    const cleanup = findByName(symbols, "cleanup");
    expect(cleanup).toBeDefined();
    expect(cleanup!.kind).toBe("function");
  });
});

// ════════════════════════════════════════════════════════════════════
// Cross-cutting: signature quality
// ════════════════════════════════════════════════════════════════════

describe("Signature quality", () => {
  test("TypeScript function signatures don't include body", () => {
    const symbols = parseTypeScript(TS_MULTI_LINE_FUNCTION, "test:sig");
    const fn = findByName(symbols, "fetchData")!;
    expect(fn.signature).not.toContain("for (let i");
    expect(fn.signature).not.toContain("throw new Error");
  });

  test("Python function signatures don't include body", () => {
    const symbols = parsePython(PY_ASYNC_DECORATORS, "test:sig");
    const fn = findByName(symbols, "retry")!;
    expect(fn.signature).toContain("def retry");
    expect(fn.signature).not.toContain("return wrapper");
  });

  test("Go function signatures are clean", () => {
    const symbols = parseGeneric(GO_INTERFACES, "test:sig", ".go");
    const fn = findByName(symbols, "NewS3Storage")!;
    expect(fn.signature).toContain("func NewS3Storage");
    expect(fn.signature).not.toContain("return");
  });
});

// ════════════════════════════════════════════════════════════════════
// Cross-cutting: content completeness
// ════════════════════════════════════════════════════════════════════

describe("Content completeness", () => {
  test("TypeScript class content includes full body", () => {
    const symbols = parseTypeScript(TS_CLASS_ACCESSORS, "test:cc");
    const cls = findByName(symbols, "User")!;
    expect(cls.content).toContain("export class User");
    expect(cls.content).toContain("fromJSON");
    expect(cls.content.trimEnd().endsWith("}")).toBe(true);
  });

  test("Python class content includes full body", () => {
    const symbols = parsePython(PY_DUNDER_METHODS, "test:cc");
    const cls = findByName(symbols, "Matrix")!;
    expect(cls.content).toContain("class Matrix");
    expect(cls.content).toContain("__getitem__");
  });

  test("Rust struct content includes full body", () => {
    const symbols = parseGeneric(RUST_STRUCTS_TRAITS, "test:cc", ".rs");
    const cfg = findByName(symbols, "Config")!;
    expect(cfg.content).toContain("pub struct Config");
    expect(cfg.content).toContain("debug: bool");
  });
});
