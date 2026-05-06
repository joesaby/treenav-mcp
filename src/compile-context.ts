/**
 * compile_context — composed retrieval primitive.
 *
 * Pure orchestration over DocumentStore's existing public methods.
 * No new ranking, no new index, no LLM calls.
 *
 * See docs/superpowers/specs/2026-05-06-compile-context-design.md.
 */

import type { ResolvedMode } from "./types";

const LOOKUP_KEY_RE = /^[A-Z]+-\d+$/;
const REGEX_META_RE = /[\\\[\]^$|]|\.\*|\(\?/;
const SYMBOL_KEYWORD_RE = /^(class|function|interface|type|enum)\s+/i;
// camelCase or PascalCase single token (no whitespace, has internal capital)
const CAMEL_TOKEN_RE = /^[A-Za-z][a-zA-Z0-9_$]*$/;
const HAS_INTERNAL_CAPITAL_RE = /[a-z][A-Z]|^[A-Z][a-z]/;

/**
 * Resolve a CompileContextMode from the raw intent string.
 *
 * Order matters: lookup before grep before symbol before search.
 *   - lookup: PROJ-44 / ITEM-1234 shaped
 *   - grep:   contains regex metacharacters
 *   - symbol: starts with class/function/etc. or is a single camelCase token
 *   - search: anything else (the natural-language path)
 */
export function resolveMode(intent: string): ResolvedMode {
  if (LOOKUP_KEY_RE.test(intent)) return "lookup";
  if (REGEX_META_RE.test(intent)) return "grep";
  if (SYMBOL_KEYWORD_RE.test(intent)) return "symbol";
  if (
    CAMEL_TOKEN_RE.test(intent) &&
    HAS_INTERNAL_CAPITAL_RE.test(intent) &&
    !intent.includes(" ")
  ) {
    return "symbol";
  }
  return "search";
}
