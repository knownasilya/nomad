// Parses one OpenUI Lang program from an assistant answer into a tree of evaluated elements, for
// <nomad-genui> (app/fg/shell-window/genui/). It reads the library's JSON Schema (schema.json), so
// the shell window bundles neither zod nor library.mjs.
//
// A program can read live data with the language's Query statement (shared/home-live.mjs): the
// tree is evaluated with `resolve(name)` answering each Query by its statement's name. Without
// one, a Query is its defaults (the third argument).

import { createParser, evaluateElementProps, evaluate } from '@openuidev/lang-core';
import schema from './schema.json';

const parser = createParser(schema, 'Stack');

// The library has no $bindings, so props evaluate without a store or prop schemas.
function evalCtx(resolve) {
  /** @type {any} */
  const ctx = {
    ctx: { getState: () => undefined, resolveRef: (name) => (resolve ? resolve(name) : null) },
    library: { components: {} },
    store: null,
  };
  return ctx;
}

const STATIC = { getState: () => undefined, resolveRef: () => null };
const value = (ast) => {
  if (!ast) return undefined;
  try {
    return evaluate(ast, /** @type {any} */ (STATIC));
  } catch {
    return undefined;
  }
};

// The program's Query statements, their arguments evaluated: [{ id, tool, args, defaults,
// refresh, complete }]. A Query's arguments can't depend on data, so this needs no answers.
function queriesOf(result) {
  return (result?.queryStatements || []).map((q) => ({
    id: q.statementId,
    tool: value(q.toolAST),
    args: value(q.argsAST) ?? {},
    defaults: value(q.defaultsAST) ?? null,
    refresh: value(q.refreshAST),
    complete: q.complete !== false,
  }));
}

/**
 * Parse once: { result, queries, meta }. `result` is lang-core's parse, evaluated by
 * evaluateProgram, as often as the data changes.
 */
export function parseProgram(source) {
  try {
    const result = parser.parse(source || '');
    return { result, queries: queriesOf(result), meta: result.meta };
  } catch (err) {
    return { result: null, queries: [], meta: { errors: [{ message: String(err?.message || err) }] } };
  }
}

// The evaluated tree, or null. `resolve(statementId)` answers a Query; it is the Query's defaults
// when it returns undefined.
export function evaluateProgram(parsed, resolve = null) {
  if (!parsed?.result?.root) return null;
  const defaults = new Map((parsed.queries || []).map((q) => [q.id, q.defaults]));
  const answer = (name) => {
    const v = resolve ? resolve(name) : undefined;
    return v !== undefined ? v : defaults.has(name) ? defaults.get(name) : null;
  };
  try {
    return evaluateElementProps(parsed.result.root, evalCtx(answer));
  } catch {
    return null;
  }
}

// { root: element | null, meta: { incomplete, unresolved, orphaned, errors, … }, queries }
export function parseGenUi(source) {
  const parsed = parseProgram(source);
  return { root: evaluateProgram(parsed), meta: parsed.meta, queries: parsed.queries };
}
