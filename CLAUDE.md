# Nomad — Claude guidelines

## Keeping the built-in AI prompt in sync with docs

`app/bg/web-apis/bg/ai.js` contains a `NOMAD_API_REFERENCE` constant that is injected as a system prompt into every `beaker.ai.chat()` call. It is a hand-maintained summary of the public JavaScript APIs.

**Whenever you add or change an API**, update both:
1. `nomad.dev/content/docs/api/apis/<api-name>.md` — the user-facing docs
2. The `NOMAD_API_REFERENCE` constant in `app/bg/web-apis/bg/ai.js` — the in-app AI context

The two should always reflect the same surface area.
