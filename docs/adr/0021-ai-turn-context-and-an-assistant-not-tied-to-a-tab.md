# Each AI turn runs its tools in its own context, and the assistant is not tied to a tab

**Status: Accepted.** 2026-10-11. Built.

With the Claude CLI as the AI runtime, a turn's tools run through the loopback MCP
(`app/bg/ai/localhost-mcp.mjs`). That MCP was made for another program on this machine, so every call
used the focused desktop tab and a personal catalog. The turn's own settings never reached it:

- A phone turn worked on the desktop's open drive, wrote directly instead of to a Draft, showed its
  permission prompts on the desktop, and sent no tool events to the phone. Stop did not stop a running
  `execute`.
- A page's `nomad.ai.chat()` turn, which is never personal (ADR-0018, ADR-0019), could reach the
  user's Names, Notes and Reader, and the focused tab's drive, and it skipped `allowWrite`.

## Decision

1. **Four stages.** Each turn has one. The stage sets what the turn may do.

   | Stage | Personal | Drive | Writes | Prompts show on |
   |---|---|---|---|---|
   | Page (`nomad.ai.chat()`, desktop or phone) | no | its own drive only | `allowWrite`; a phone page's go to a Draft | the device the page is on |
   | Desktop sidebar | yes | none by default (3) | as today | desktop |
   | Phone panel | yes | none by default (3) | Draft | phone |
   | Outside program (loopback MCP, no token) | yes | the focused tab | as today | desktop |

   The stages and their rules are in `app/bg/ai/stages.mjs`. The Bridge wire format does not change.
   The phone sends `personal`, and the Provider maps it to the phone panel or a page (`remoteStage`).
   A remote Device can't claim another stage.
2. **A token per turn on the loopback MCP.** `runChat` builds one set of tool options for the turn.
   On a CLI runtime it opens a turn (`openTurn`) that holds them under a random 32-byte token, and
   closes it when the turn ends. The CLI's MCP config sends the token in the `x-nomad-turn` header
   (`mcpConfig` in `agent-cli.mjs`). A call with a known token runs with that turn's sender and options
   (`callLocalTool`). A call with an unknown token fails: it never falls back to the focused tab. A call
   with no token is an outside program. A turn uses the port the MCP really listens on
   (`NOMAD_MCP_PORT`), so a dev run never sends its calls to the user's own Nomad.
3. **The assistant is not tied to a tab.** The desktop sidebar and the phone panel each keep one
   conversation, not one per site or per drive. A tab switch doesn't stop a turn. A personal turn
   starts with no drive: `runChat` passes a `currentTab` lookup, and `executeTool` calls it on every
   call. On desktop it is looked up live in the sidebar's own window. On the phone it is the `tab`
   snapshot (`{ url, title }`) that the phone sends with each message, because the desktop can't see a
   phone WebView. The `currentTab` capability gives the model `{ url, title, drive, writable }`. A read
   without `drive` uses the tab's drive. A write must name its drive (`pickToolDrive`, and `drive` is
   required in the write's schema), so a tab switch mid-turn can't move a write. Page tools stay with
   the tab the user sent from.
4. **Permission grants stay per site** (ADR-0019 §4). The tab that is current when a call runs is that
   call's sender, so a prompt is for its site, not for "the assistant". `askOncePerTurn` keeps one
   answer per permission and site, so a "yes" on one site doesn't carry to the next tab in the same
   turn. Hostile text on a site can try to steer the AI, so the user must see a prompt on that site
   first.
5. **One model choice for the sidebar.** It is saved on this device and stays until the user changes
   it. "Default" means the default in Settings → AI, which also serves pages and the phone. "This model
   can see images" is kept per model id, not per site.
6. **Start fresh.** The sidebar keeps its sessions in `hyper://private/.ai-chat/sessions/` and its model
   choice in the `ai_sidebar_prefs` setting. It does not read the old per-site sessions and preferences
   (`hyper://private/.ai-chat/<site>/`). The files stay where they are.
7. **A Drive's AI Config is for its own app.** A page's turn still uses the Drive's `/ai/system.md`. The
   sidebar and the phone panel skip it: the assistant reads any tab, and a Drive must not steer the
   user's own AI, which can reach their Notes. The Space default still applies.
8. **A write event names its drive.** Every `write` tool event carries `drive`. The sidebar's Revert
   restores each file in its own drive, and an editor reloads only when it shows that drive. The phone
   keeps its Draft banner per drive. The sidebar starts a Draft for a writable drive the first time a
   conversation is used on it.

## Steps in plain words

The step list shows one line per search, execute and capability call (`app/bg/ai/tool-summary.mjs`):
"Searching for “grocery notes”", "Running code to read a file and write a file", "Writing /index.html
in blog". The Provider writes the labels, so the phone shows them as they come. The phone panel shows
its steps for the whole turn, under the answer as it streams, not only until the first words arrive.

## Consequences

- A phone page that is not a drive can't be read by the AI yet. A later Bridge frame could ask the
  phone for its current tab live, with the page text.
- The phone has no model picker. One would need a Bridge frame that lists the Provider's models.
- The desktop sidebar's step list still hides once the answer starts. It gets the new labels.
- The loopback MCP's outside stage still works on the focused tab, and a write there may still use
  that tab's drive without naming it.
