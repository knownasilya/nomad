// Parses one OpenUI Lang program from an assistant answer into a tree of evaluated elements, for
// <nomad-genui> (app/fg/shell-window/genui/). It reads the library's JSON Schema (schema.json), so
// the shell window bundles neither zod nor library.mjs.

import { createParser, evaluateElementProps } from '@openuidev/lang-core';
import schema from './schema.json';

const parser = createParser(schema, 'Stack');
// The library has no $bindings or Queries, so props evaluate without a store or prop schemas.
/** @type {any} */
const EVAL = {
  ctx: { getState: () => undefined, resolveRef: () => null },
  library: { components: {} },
  store: null,
};

// { root: element | null, meta: { incomplete, unresolved, orphaned, errors, … } }
export function parseGenUi(source) {
  try {
    const result = parser.parse(source || '');
    return {
      root: result.root ? evaluateElementProps(result.root, EVAL) : null,
      meta: result.meta,
    };
  } catch (err) {
    return { root: null, meta: { errors: [{ message: String(err?.message || err) }] } };
  }
}
