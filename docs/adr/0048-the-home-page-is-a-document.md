# The home page is a document the AI can draw

**Status: Accepted** 2026-11-11, built as below. Builds on ADR-0027 (generated UI in the AI Sidebar),
the home page dashboard (`shared/home-dashboard.mjs`), ADR-0044 (its amendment: pages built from
components, `saveAsset` `openui`) and ADR-0047 (items link back to the chat that made them).

The AI Sidebar could draw an answer with charts, tables and cards, but the drawing stayed in the
chat. The home page (nomad://desktop) showed one fixed dashboard for everyone. The component set was
also small: no grid, no list with parts, no form, and few ways to vary a component.

## Decision

1. **A second set of components, with slots and variants.** The library
   (`app/lib/genui/library.mjs`) gains layout (Grid, GridItem, Columns, Accordion, Collapsible,
   Carousel, Header), content (Icon, Avatar, AvatarGroup, User, Kbd, Link, Breadcrumb, CodeBlock,
   Empty, Feature), lists (List, ListItem, DataList, Tree), numbers (Sparkline, Calendar) and forms
   (Form with Input, Textarea, Select, RadioGroup, CheckboxGroup, Switch, Slider). The API follows
   Nuxt UI's ideas, in a language with positional arguments:
   - `color` is the hue (neutral, primary, info, success, warning, error), `style` how strong it is
     (soft, outline, solid), `size` s, m or l.
   - A **slot** is an argument that takes a component: a Card's `footer`, a CardHeader's `trailing`,
     a ListItem's `leading` and `trailing`, a Header's and a Callout's `actions`.
   - `icon` is a name from a fixed list (`app/lib/genui/icons.mjs`, Font Awesome 5 solid, each
     checked against the font by a test). Any other name draws nothing, so a model can't name a
     class.
   - Existing components only gain arguments at the end (Card `footer`, `color`; Stat `icon`,
     `color`, `spark`; Table `pageSize`, `variant`, `caption`; …). A saved chat is parsed again
     when it is opened, so an old program must still parse.
   Nothing new loads anything by itself: still no Image, text is still drawn as text, and an action
   still runs only on a click. A Form's values stay in the element until Submit, which sends one
   message the user can read (its title and a "Label: value" line per field); it has no password
   field.
2. **The prompt is in tiers.** Every sidebar turn carries the core components (`genuiPrompt()`,
   under 13,500 characters), which names the rest and says where their arguments are:
   `guide:genui-components` (`genuiMoreSignatures()`), read through `search` when the model wants
   one. `guide:genui-pages` teaches all of them (`genuiFullPrompt()`), `guide:dashboard` the home
   page. Teaching every component every turn would have doubled the prompt for answers that are
   mostly text.
3. **The home page has a layout, and it is a program.** What nomad://desktop shows is an
   openui-lang program (`shared/home-layout.mjs`). It places the page's **live parts** with widget
   components the library defines only for it: HomeGreeting, HomePins, HomeNeedsYou,
   HomeNotifications, HomeJobs, HomeEvents, HomeNotes, HomeFiles (the last five take a `limit`) and
   HomeCards. A widget takes no data: the page fills it with the user's own things, so a layout
   can't go stale and the model never copies the user's notes into it. Around them a layout can use
   any other component. `DEFAULT_LAYOUT` is the dashboard as it was, so a Space with no layout of
   its own looks the same as before.
   - `<nomad-genui host>` draws the layout. Each widget becomes a `<slot>`, and `genui-widgets`
     tells the page which is which; the page puts its own element there, drawn and styled as before
     (`app/userland/desktop/`). The page's parts never run inside the drawing, so the layout can't
     reach what they show.
   - Needs you is always shown: the page adds it at the top when a layout leaves it out, or has it
     in a tab that isn't open. A part placed twice shows once. Cards show after the layout when it
     has no HomeCards() anywhere (`widgetsIn` reads the whole program, so one in a closed tab
     counts).
   - A layout that no longer draws (a newer or older Nomad) gives way to the default, and the page
     says so.
4. **Cards.** A pinned card is a program of its own (`/cards/<id>.json`: title, source, `wide`,
   `order`, `ai`), drawn by its own `<nomad-genui framed>` in the page's frame, so one that fails
   leaves the rest alone. Up to 24. A card holds what was written into it and doesn't update by
   itself. Its "…" menu moves it, widens it, removes it, opens the chat that made it and asks the AI
   to change it.
5. **It is the user's own, per Space.** `/.vault/home/spaces/<space>/layout.json` and `…/cards/`
   in the Vault, never in a shared Space's Library: a home page is one person's, and it follows them
   to their other computers. The layout record keeps the one it replaced (`previous`), so Customize →
   Restore previous layout is always one step back, and Reset to default keeps the user's layout the
   same way.
6. **Who changes it.**
   - The user pins a finished drawing with **Pin to Home** under it in the AI Sidebar
     (`aiShell.pinToHome`).
   - The user's AI: `getDashboard` (permission `dashboardRead`), `pinDashboardCard`,
     `removeDashboardCard`, `setDashboard` (`dashboardWrite`). Personal turns only, never a Job, and
     `getDashboard` counts as a private read (ADR-0037). Every program is parsed before it is kept
     (`programError`), and a card or layout records its chat (ADR-0047).
   - The page itself changes only what needs no drawing: move, widen, remove, reset, restore
     (`nomad.vault.updateHomeCard`, `removeHomeCard`, `resetHomeLayout`, `restoreHomeLayout`). For
     anything else, Customize and the card menu open the AI Sidebar with the request begun as a
     **draft** in its input (`nomad.aiChats.openNew({ draft })`). A Button in a card that talks to
     the assistant does the same. The page never sends a message for the user.
7. **Links in a card** open in the tab, and only what `parseItemLink` allows: a web or hyper:// page,
   or one of the user's things. `nomad://desktop/` is a link an answer may open (`HOME_LINK`).

## Consequences

- The dashboard, the AI's answers, saved pages and pinned cards are one language and one renderer.
  A new component is available in all four.
- The every-turn prompt grew by about 2,100 characters (the new arguments and the common icon
  names), not by the 8,400 more the second set would cost. A model that wants a newer component
  spends one `search` call on the guide.
- The home page loads `<nomad-genui>` as a bundle (`nomad://app-stdlib/js/genui.build.js`, built
  from `app/fg/genui-page/element.js`), about 440 KB read from disk, Leaflet included.
- The phone's home tab still shows the fixed dashboard: it has no renderer for the language. Its AI
  panel can pin a card or change the layout, which shows on the user's computers.
- A card is a snapshot. A Job can keep one current by drawing it again on every run (amendment
  below); a card can also carry a Button that asks for its own refresh.
- A shared Space has no shared home page. Each member has their own.

## Amendment: a Job keeps a card (2026-11-12)

A card was a snapshot, and keeping one current was left for later. Now a Job can keep one card of
its own: a morning briefing, a price it watches, the day's numbers.

1. **A grant.** `writes.home` on the Job (shared/jobs.mjs, "Keep a card on my home page" in My
   Library → Jobs). Like `newDrives`, it is set only when given, so older Jobs keep the same record,
   and the AI's `saveJob` asks the user for it (`jobWrites`). It needs no permission at run time: it
   only adds a capability to the Job's turn (`WRITE_CAPS.home`).
2. **One capability, for Jobs only.** `setJobCard({ openui, title?, wide?, remove? })` (gate
   `job`, not in `JOB_CAPS`: only the grant turns it on). A Job still never gets `getDashboard`,
   `pinDashboardCard` or `setDashboard`: it changes its own card and nothing else on the page. A
   `job.js` can call `nomad.setJobCard(...)` itself, with no model turn.
3. **One card per Job**, in the Job's Space (`job.space`). The card record gains
   `job: { id, title, at }` (`makeJobCard`, `jobCardOf`); each call replaces the program and keeps
   the user's changes (its place, wide or narrow). It is parsed like any card, and records the run's
   origin (ADR-0047). In a shared Space whose home page is the household's, the card is everyone's.
4. **The page shows whose it is.** Under a Job's card: the Job's name (a link to it in My Library),
   when it last drew the card, "Last run failed" when the newest run failed, and a Run now button
   (a spinner while it runs). `nomad.vault.homeDashboard` adds the Job's state (`withJobState`). The
   card's menu offers Open the Job and Run the Job Now, and its Ask AI draft asks to change the Job,
   since the next run would replace a change made to the card.
5. **It goes when the grant goes.** Removing the card on the page also takes `home` off the Job
   (`removeHomeCard`), or the next run would put it back. Taking the grant away or deleting the Job
   removes the card (`bg/ai/jobs.js` `dropCard`).

The run records "Drawing its card on your home page" in its `changes`, like a Note it writes.
