# Secrets: API keys the AI and Jobs use by name, without seeing them

**Status: Accepted.** 2026-10-31.

The user wants the AI Sidebar and AI Jobs to call APIs that need a key ("check my GitHub
notifications every morning", "post the build status to Slack") without pasting the key into a chat,
a prompt, a drive or a Job's `job.js`. Anything the model sees, it can repeat: into its answer, a
file, or a request to a site a page told it about. So the model, the page, the execute sandbox and
Nomad's own UI must never hold a value. A **Secret** is a value the user saves once and the AI uses
by name. The rules are in `app/bg/ai/secrets.mjs`, the store is `app/bg/ai/secret-store.js`, the
request is `app/bg/ai/http-request.mjs`, the capabilities are wired in `app/bg/web-apis/bg/ai.ts`,
and the UI is My Library → Secrets (`app/userland/library/js/views/secrets.js`, internal
`nomad.secrets` API).

## Decision

1. **A secret lives on one computer, encrypted with its keychain, and nowhere else.**
   `<userData>/ai-secrets.json` holds `{ name, note, hosts, inject, chat, jobs, … }` and the value
   encrypted with Electron `safeStorage` (Keychain, DPAPI, libsecret/KWallet). Linux's `basic_text`
   fallback is a fixed key, so with it Nomad refuses to save a value. Not the Vault: the Vault is an
   Autobase every linked Device replicates in plain form, and it isn't encrypted at rest. Not
   `hyper://private/`, which syncs too, and not a Space Library, which other people can read. A Job
   runs on one computer (ADR-0030), and the phone's AI turns run on a computer over the AI Bridge, so a
   key on that computer is enough. That also answers Shared Spaces: a Space never holds a secret.
   Personas (PR #98) speak of a Vault for identity; this is a different kind of data, and it stays out
   of the replicated one.
2. **Write-only.** A value goes in through My Library and never comes out through any API: lists give
   `hasValue`, the form can replace a value, not show it. The one reader is the request path in the
   main process.
3. **The AI uses a secret by name, and Nomad puts it where the user said.** `httpRequest({ url, method,
   headers, body | json | form, secrets: ['GITHUB_TOKEN'] })` is a new capability. Each secret has an
   `inject` the user set: a header with a format (`Authorization: Bearer {value}` by default; `{base64}`
   for Basic auth), a query parameter, a field of a JSON or form body (an OAuth `refresh_token` or
   `client_secret`), or the whole URL (a webhook). The model can't choose where the value goes, so it
   can't move it into a path, a body field it controls, or a gist. Placeholders the model writes
   (`{{secret:NAME}}` anywhere) were the other option. They're simpler to explain, but a placeholder in
   a body sends the key wherever the body goes, for example a public paste on an allowed host.
4. **Only to the user's hosts.** Each secret lists the hosts it may go to (`api.github.com`,
   `*.example.com`, not `*.com`). A request whose URL isn't on one of them fails before any value is
   read. Redirects are followed by hand and only to hosts every secret on the request allows. URLs with
   `user:pass@` are refused.
5. **Echoes are taken out.** Every tool result and error on every turn (the sidebar, the phone, Jobs,
   the loopback MCP, and every capability `execute` calls) has each known value replaced with
   `[secret NAME]`: as it is, URL-encoded, base64 and JSON-escaped. So does `httpRequest`'s own
   response, headers and URL. This also covers a key the user opens on a page that the AI then reads.
6. **Who may use one.** The turn's stage decides (ADR-0021; `stageRules().secrets`):
   - **The AI Sidebar and the phone's AI panel** may use a secret marked "the AI can ask" (`chat`),
     after the user says yes. The `aiSecretUse:<NAME>` prompt names the secret and its hosts, is asked
     once per turn per secret (`askOncePerTurn`), and isn't kept. A yes for one conversation shouldn't
     become a standing grant to a key. The phone shows its own prompt for it.
   - **A Job** uses only the secrets the user ticked for that Job, on the secret's page. The grant is
     kept in the local store (`jobs: [jobId]`), not in the Job's Vault record, so no other Device, and
     not the AI, can grant one. The AI can tell the user which secret a Job needs; it can't tick the
     box. A deleted Job's grants go with it.
   - **A page's `nomad.ai.chat()`** and **another program through the loopback MCP** get neither
     capability.
7. **A Job still changes nothing in Nomad, and changes things on the web only with a secret.** In a
   Job, `httpRequest` with any method but GET or HEAD must carry one of the Job's secrets, so prompt
   text a Job reads can't make it post the user's Notes to a site the text names. (A GET to anywhere is
   the same as `fetchUrl` today.) Jobs that edit drives and pages are separate work.
8. **Not this computer, and the local network only with a secret for it.** `httpRequest` never
   connects to loopback (`127.0.0.0/8`, `::1`). That's where the loopback MCP listens, and a request to
   it would get a Job out of its stage. Private, link-local and CGNAT addresses (the user's router, a
   Home Assistant, cloud metadata) are reachable only when a secret on the request names that host.
   Addresses are checked after DNS, in the socket's `lookup`, so a hostname that resolves to one is
   refused too.
9. **Refreshing a token without seeing it.** `saveToSecret: { ACCESS_TOKEN: 'access_token' }` reads a
   value from a 2xx response (a JSON path, or `header:<name>`) into an existing secret, which the turn
   must be allowed to use and whose hosts must include the responding host. The response the model
   gets has `[secret ACCESS_TOKEN]` in its place. A refresh that fails leaves the old value. The user
   makes the secret first, possibly without a value, so they decide its hosts and where it goes.

## Consequences

- **A secret stays on the computer it was made on.** Moving a Job to another computer ("Run it on this
  computer instead") leaves its secrets behind; the user adds them there. Syncing them would need
  values encrypted to each Device's key, plus a way to revoke a lost Device. That can come later without
  changing how the AI uses them.
- **Misuse on an allowed host is still possible.** A page's text can talk the sidebar's AI into calling
  the GitHub API with the user's token, for example to delete a repo. The per-turn prompt, naming the
  secret, is the check there. Scoping a secret to read-only methods or paths would narrow it further.
- **Redaction is a guard, not the boundary.** The boundary is that the model never gets a value. A
  server that echoes a value transformed (hashed, or base64 of `user:token` that isn't the value alone)
  isn't caught. A value shorter than 4 characters isn't searched for.
- **The keychain is required.** On a Linux desktop without a keyring, My Library says why it can't
  save. A value encrypted with a keychain that later changes can't be read, and shows as "no value
  yet" until the user sets it again.
- `httpRequest` returns text bodies up to 100,000 characters and describes binary ones. It is the
  user's own AI's only; `fetchUrl` stays for pages' own AI.
