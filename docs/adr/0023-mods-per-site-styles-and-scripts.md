# Mods are the user's own styles and scripts for a site, kept in the Vault

**Status: Accepted.** 2026-10-29.

A **Mod** changes how a site looks or works, for this user only, like Arc's Boosts. It belongs
to a site and holds any of: **preset styles** (dark mode, sepia, grayscale, no animations, hide
images), **elements to hide** (CSS selectors, picked with the element picker or typed), **custom CSS**, and
**custom JavaScript**. Each has a name and an on/off switch the user flips from the tab. A site can
have several ("Dark", "Distraction-free", "Auto-expand comments"). The rules are in
`shared/mods.mjs`; the browser side is `app/bg/ui/mods.js`; the page side is
`app/fg/webview-preload/mods.js`.

## Decision

1. **One set per user, in the Vault**: `/.vault/mods/<id>.json`
   `{ type: 'nomad/mod', id, name, site, enabled, presets, hide, css, js, createdAt, updatedAt }`.
   Like Highlights (ADR-0020) and Names (ADR-0018), so every linked Device has them, the phone can
   list them, and a solo Vault that joins another brings them along. One record per Mod, so two
   Devices editing different Mods never overwrite each other. `enabled` is in the record too:
   turning a Mod off turns it off everywhere, as in Arc.
2. **A site is a host without "www."**, and a Mod applies to that host and every host under it
   (`example.com` covers `www.` and `docs.example.com`), over http, https and hyper://. Not nomad://
   pages, not `hyper://private/`, not frames. Arc matches by domain the same way; per-path Mods
   weren't worth the extra UI.
3. **bg keeps them in memory; the preload applies them.** `bg/ui/mods.js` holds every Mod, as
   `names.js` does, refreshed on the Vault's updates. The preload asks for its page's
   `{ css, scripts }` with a **synchronous** IPC as the page starts, so styles are in before the
   first paint (a dark-mode Mod never flashes white). CSS goes in with `webFrame.insertCSS` and is
   swapped in place when a Mod changes. Scripts run once per load in the page's **main world**
   (`webFrame.executeJavaScript`, inside an async function, errors logged under the Mod's name),
   when the DOM is ready. A script can't be taken back, so a page whose script was turned off or
   edited reloads (when it is next shown). The page can't read the Mods: the data stays in the
   preload's isolated world, and the IPC answers only for the sender's own top frame.
4. **Presets mix.** Each preset adds a CSS filter, CSS of its own, or both. The filters of every
   preset turned on for a page become one `filter` on the root element, so dark mode plus sepia is
   one warm dark page; dark mode turns images and video back. A preset asked for by two Mods
   applies once. Then each Mod's hidden elements (one `display: none !important` rule per
   selector, so a bad selector breaks only itself) and its CSS, oldest Mod first.
5. **The element picker picks elements to hide.** Started from the Mods menu or right-click > Hide
   Elements on This Site…, it outlines what's under the pointer; a click hides it, Shift-click hides
   every element with the same tag and stable classes, ↑/↓ pick the parent or go back, Esc ends it.
   It draws in a closed shadow root and blocks the page's own clicks while it runs. The selector is
   built from what should hold on the next load: a stable id if one is near, else tags with their
   stable classes and a position among same-tag siblings only when needed. Generated names (CSS
   modules, CSS-in-JS hashes, long numbers) and state classes (`active`, `is-open`) are skipped.
   Picks go to the Mod the user picked from, or the site's first Mod that is on, made when the
   site has none.
6. **The tab.** A Mods item in the location bar's site menu (the arrow at its right end) on every
   page Mods can change; the arrow is blue while one of the site's Mods is on. (Amended: this was
   a magic-wand button in the location bar.) The Mods menu lists the site's Mods with a switch each, quick
   style chips (a preset goes on in the site's first Mod, and off in every Mod that has it), the
   element picker, and links to **My Library → Mods**, where a Mod's name, site, presets, selectors, CSS
   and JavaScript are written.
7. **The user's own AI can read and write them.** `listMods`, `saveMod` and `deleteMod` are
   personal capabilities (ADR-0019), so the AI Sidebar, the phone's AI panel and the loopback MCP
   server all have them. Reading and changing are two new permissions, `modsRead` and
   `modsWrite`; changing is marked dangerous because a Mod can run a script on every page of a
   site. The prompt tells the model to prefer presets and selectors, then CSS, and to write
   JavaScript only when the user asks for behavior.

## Consequences

- A Mod's JavaScript runs with the page's own power, as a bookmarklet or userscript does. Only
  the user's Devices write the Vault, so a script comes from the user, the AI they allowed, or one
  of their Devices. A page's text could still try to talk the AI into a harmful script; the
  `modsWrite` prompt, asked once per turn, is the guard.
- A page can tell it has a Mod (its computed styles change, and a script's effects show). It
  can't read the Mods.
- Inverting colors is a blunt dark mode: it is right for most light pages and wrong for pages that
  are already dark, where the user just leaves it off.
- The phone lists Mods (through the AI) but doesn't apply them in its WebView yet.
