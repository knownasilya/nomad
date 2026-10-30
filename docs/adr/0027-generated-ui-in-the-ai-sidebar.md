# The AI Sidebar draws charts, maps and other UI the model writes in OpenUI Lang

**Status: Accepted.** 2026-10-30.

The user wants the sidebar's assistant to answer with UI when that says it better than text: a
chart of numbers it read, a map of places, a table, a plan, buttons for the next step. We use
[OpenUI](https://github.com/thesysdev/openui) (MIT): its OpenUI Lang is a compact language made for
models to stream UI in, with a framework-free parser and prompt generator
(`@openuidev/lang-core`). OpenUI's own component libraries are React; the shell window is lit, so
we use only the parser and prompt generator and draw the components ourselves.

## Decision

1. **UI is fenced in the Markdown answer.** The model writes a program in a ```` ```openui-lang ````
   fence; text outside it is Markdown as before. `app/lib/genui/segments.mjs` splits an answer, and
   the sidebar draws each program with `<nomad-genui>` (`app/fg/shell-window/genui/`). The answer is
   stored and copied as the Markdown it arrived in, so saved chats and Copy need nothing new, and an
   answer without a fence renders exactly as before. A fence still streaming is parsed on every
   chunk, so the UI fills in as it arrives.
2. **Our own component library**, `app/lib/genui/library.mjs`: layout (Stack, Card, CardHeader,
   Tabs, Separator), content (TextContent, Callout, Tag, TagBlock, Steps, Stat, Progress), Table,
   charts (Bar, HorizontalBar, Line, Area, Pie, Scatter), Map, Buttons, and cards for a purpose
   (EntityCard, LinkCard, ProductCard, EventCard, QuoteCard, ProsCons, Timeline, in a CardGrid).
   Names and argument order follow OpenUI's chat library where it has the component; Stat,
   Progress, Map and the purpose cards are ours. A card is one call, so a list of results streams in
   card by card, and a card's url opens like `@OpenUrl` (below). The
   prompt section is generated from it (`genuiPrompt()`, about 2,700 tokens) and added to every
   sidebar turn, local or over the AI Bridge, with `genUi: true` (`ai-shell.ts`). Pages'
   `nomad.ai.chat()` and the phone don't get it: they don't render it.
3. **The shell window bundles the parser, not the library.** It parses against the library's JSON
   Schema, `app/lib/genui/schema.json`, written by `node scripts/gen-genui-schema.mjs` and checked
   by `tests/unit/genui.test.js`.
4. **Drawn with lit, no HTML from the model.** Every string goes in as text. Charts are our own SVG
   (`genui/charts.js`) in the shell's tokens and a fixed eight-color order with dark steps, each
   with a hover tooltip and a Data table. Maps are Leaflet with OpenStreetMap tiles
   (`genui/map.js`), inverted in dark mode; the wheel scrolls the chat, not the map.
5. **No images, nothing loads by itself.** There is no Image component: a URL the model picks would
   load as soon as the answer renders, and a page the model read could put data in it. Map tiles
   come only from tile.openstreetmap.org and reveal only which area is shown.
6. **Actions run only on a click, never mid-turn.** `@ToAssistant("…")` sends that text as the
   user's next message, visibly. `@OpenUrl` opens an http(s) or hyper:// page in a new tab. A link
   inside the UI (the map's attribution) opens in a tab too, never in the shell window. OpenUI's
   `$bindings`, `Query` and `Mutation` are off: the UI can't call tools.

## Consequences

- The shell window's bundle grows by about 700 KB unminified (lang-core, which pulls in zod, and
  Leaflet). Frontend bundles now set `inlineDynamicImports`, because lang-core's telemetry loads
  ci-info with a dynamic import that would otherwise be a separate chunk nobody serves.
- lang-core sends install telemetry from its `postinstall`. The root `postinstall` installs `app/`
  with `OPENUI_TELEMETRY_DISABLED=1`; runtime telemetry is off unless opted in, and never runs in a
  browser.
- A model that writes bad openui-lang gets its source shown as code once the answer ends, and any
  component it misnames is dropped.
- The phone's AI panel shows the fence as a code block until it gets a renderer of its own.
