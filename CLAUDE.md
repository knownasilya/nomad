# Nomad — Claude guidelines

## Keeping the built-in AI prompt in sync with docs

`app/bg/web-apis/bg/ai.js` contains a `NOMAD_API_REFERENCE` constant that is injected as a system prompt into every `beaker.ai.chat()` call. It is a hand-maintained summary of the public JavaScript APIs.

**Whenever you add or change an API**, update all three:
1. `nomad.dev/content/docs/api/apis/<api-name>.md` — the user-facing docs
2. The `NOMAD_API_REFERENCE` constant in `app/bg/web-apis/bg/ai.js` — the in-app AI context
3. `app/userland/editor/js/types/beaker-dts.js` — the `beaker.*` TypeScript declarations that drive
   autocomplete/hover in the code editor (Monaco)

The three should always reflect the same surface area.

## Editor TypeScript types

The Monaco editor (`app/userland/editor/`) gives autocomplete/hover for `beaker.*` and the
walled.garden schemas. Two type sources feed it via `addExtraLib` (see
`app/userland/editor/js/language-service.js`):
- `types/beaker-dts.js` — hand-maintained `beaker.*` declarations (keep in sync, above).
- `types/schemas-dts.js` and `types/schemas-json.js` — **generated** from the Zod schemas by
  `scripts/gen-schema-dts.mjs` (run automatically in `scripts/build.js`). The first gives JS/TS the
  `WalledGarden.*` types; the second is a combined JSON Schema (discriminated on the `type` field)
  registered with Monaco's JSON service so `.json` files get schema autocomplete/validation. Do not edit
  by hand; rerun the build after changing any `app/lib/schemas/walled.garden/*.js`.
