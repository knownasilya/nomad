# Manifest `fallback`: static-host SPA routing replaces the `.ui` takeover

**Status: Accepted.** Implemented 2026-07-10 in the desktop protocol handler
(`app/bg/protocols/hyper.js`, both the Hyperdrive and Autobase serve paths), the mobile gateway
(`mobile/backend/lib/http-gateway.mjs` + `drive-manager.mjs`), and the shared helpers
(`shared/frontend-routing.mjs`). The legacy `/.ui/ui.html` convention keeps working unchanged;
`fallback` supersedes it when both are present.

## The problem: `.ui` is a Nomad-ism, not a web convention

The frontend mechanism inherited from Beaker — "an HTML file at `/.ui/ui.html` is served for every
HTML navigation" — delivers the right capability (an SPA that owns the drive's whole URL space and
routes off `location.pathname`) with three ergonomic costs:

1. **A dead `/index.html` stub in every app drive.** Because `/.ui/ui.html` shadows everything,
   templates ship an `/index.html` that Nomad never serves — a `<meta http-equiv="refresh">` plus
   an anchor tag whose only job is graceful degradation on runtimes that don't know the
   convention.
2. **Takeover semantics surprise people.** The frontend shadows *existing* HTML files: with both
   `/index.html` and `/.ui/ui.html` present, visiting `/` serves the latter. Real files losing to
   a shell is backwards from every static host a web developer has used.
3. **A magic dot-path that has to be taught.** Nothing on the web platform works this way, and
   dot-folders fight tooling (nomad.dev's template copier rewrites `/ui/` → `/.ui/` because Hugo
   won't serve dot-folders).

The industry converged on the opposite shape: **the app shell is `/index.html`; existing files
always win; misses rewrite (HTTP 200, URL unchanged) to the shell.** Netlify's `_redirects`
(`/* /index.html 200`), Azure Static Web Apps' `navigationFallback`, Cloudflare Pages' SPA mode —
and, closest to home, IPFS, which standardized exactly this for content-addressed p2p sites in
IPIP-0002 with the hard rule that *redirect logic is only evaluated if the requested path is not
present in the DAG*.

## Decision

1. **`index.json` grows one optional key: `"fallback": "/index.html"`** — an absolute in-drive
   file path served when an HTML **page navigation** asks for a path that resolves to no real
   file. It is a 200 rewrite: the body is the fallback file, the address bar keeps the requested
   URL, so client-side routing works exactly as under `.ui`.

2. **Real files always win.** The fallback is consulted only on a miss — a path with no entry,
   or a directory with no index file. It never shadows an existing file of any type. `/` serves a
   real `/index.html` as itself, which is what makes the shell double as the entry point.

3. **Only page navigations fall back.** Detection prefers the platform's explicit fetch metadata
   (`Sec-Fetch-Dest: document`/`iframe`) and falls back to `Accept: text/html` sniffing where the
   engine doesn't send it (custom protocols, older WebViews). A `fetch()` for a missing `.json`,
   an `<img>`, a script — all 404 honestly; the SPA can handle its own misses.

4. **Declared beats legacy.** When a manifest declares a (valid) `fallback`, `/.ui/ui.html` is
   not consulted at all. Without one, `.ui` behaves exactly as before — no existing drive changes
   behavior. Migration is: add the manifest line, move the shell to `/index.html`, delete `/.ui`.

5. **Degenerate cases fail soft.** A malformed `index.json`, a non-string / relative /
   directory-like `fallback` value, or a fallback target that doesn't exist all read as "no
   fallback declared" and fall through to today's behavior (builtin drive-view for directories,
   404 for files). The target is read directly, not re-routed, so it cannot recurse.

6. **The value is a file path, not a "frontend directory".** A directory doesn't answer the
   question the serve path asks (what to serve on a miss), and `"fallback": "/app/index.html"`
   already covers the keep-the-app-out-of-the-root layout for those who want it. `/index.html`
   is the idiomatic, documented value — it is what makes a Nomad drive degrade to a plain static
   site for free (root renders anywhere; only deep links need a `.ui`-aware runtime).

The string form is deliberately the whole v1 surface. If real needs appear, the same key can grow
an object form (`{ "rewrite": ..., "exclude": [...], "mode": "takeover" }`, per Azure's
`navigationFallback`) without breaking the string form.

## What this deliberately does NOT replicate

`.ui`'s takeover of *existing* HTML files (the "consistent theme wrapped around raw content pages"
pattern) has no equivalent under `fallback` — that shadowing is the surprising part, and drives
that want it keep using `.ui`, which remains supported indefinitely as the legacy mode.

## Consequences

- New app drives need no `/.ui` folder and no stub: `/index.html` + `"fallback": "/index.html"`
  is the whole pattern, and it is the same mental model as Netlify/Cloudflare/IPFS.
- `index.json` becomes load-bearing for routing on drives that opt in (it already is for `csp`);
  hence the fail-soft rule in (5).
- Desktop and mobile now share the routing contract byte-for-byte
  (`shared/frontend-routing.mjs`, unit-tested in `tests/unit/frontend-routing.test.js`), the same
  pattern as `shared/fs-core.mjs`. The Autobase serve path reads `/index.json` through the same
  view as content (including Draft preview overlays), so a previewed Draft can stage a manifest
  change.
- The nomad.dev templates still use `.ui` and keep working; migrating them (and their docs) to
  the `fallback` pattern is follow-up work, tracked outside this ADR.
