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
- A card is a snapshot. Keeping one current (a Job that rewrites its card) is not built; a card can
  carry a Button that asks for its own refresh.
- A shared Space has no shared home page. Each member has their own.

## Amendment: live cards (2026-11-12)

A card was a snapshot: it held what the AI wrote into it. Cards like "today's events" or "my
briefing Job's last answer" went stale the day they were made, and the way out was to copy the
user's data into a program, which the decision above avoids for the layout.

1. **A program can read live data with the language's own Query statement.** openui-lang already
   has `name = Query("tool", {args}, defaults, refreshSeconds)`, with `@Each`, `@Count`, `@Filter`
   and the other @ functions, dot access and ternaries to use its result. lang-core's QueryManager
   runs the queries, each on its own interval, and the tree is evaluated again when an answer comes.
   `<nomad-genui live=…>` (app/fg/shell-window/genui/) runs it; parse.mjs splits parsing from
   evaluating so the same parse is drawn again with new data.
2. **The tools are Nomad's read-only live sources** (`shared/home-live.mjs`): `events` (the calendar
   from now on), `jobs`, `jobRuns` (a Job's runs by id or title, with `last`), `notes` (by topic),
   `driveFile` (a JSON, CSV or text file up to 512 KB) and `driveFolder`. Every result has `items`
   and `count`, so one default fits all of them. The rules check arguments, keep a Query's interval
   between a minute and a day (each source has its own default), and shape each result from records
   the caller read. A program whose Query names anything else is refused when it is kept
   (`programError`), so a card never asks for something the page can't answer.
3. **The page answers, from the viewer's own things.** nomad://desktop answers each Query with
   `nomad.vault.homeQuery` (app/bg/web-apis/bg/home-live.ts), from the page's Space, as the same
   person sees it elsewhere. The data is never written into the program, and the model doesn't see
   it there: in a shared Space each member sees their own. The page reads the Vault and Job sources
   again when it hears they changed, when the tab shows again, and on each Query's interval; a
   drive is read on its interval or by hand. A live card says when it last read its data, with a
   Refresh button, and a Query that fails says so under the drawing while the rest still draws.
4. **The AI Sidebar answers them too** (`aiShell.liveQuery`), so a live drawing shows the user's
   data before it is pinned, and Pin to Home keeps it live. A saved page in Assets and the phone
   have no answerer: they draw the defaults.
5. **Links.** A drawing with live data opens a link only when the program spells it out, or the
   data carries it (an item's `url`, built by the sources from an id). A link put together from
   the data (a site address plus a Note's title) doesn't open, so a card can't send the user's data
   to a site with a click.
6. **The model looks before it writes.** `previewLiveData({ source, args })` returns what a Query
   would show now (a few items), so the model writes the card around the real shape. It asks
   `dashboardRead` and the permission the same data needs anywhere else (`calendarRead`, `jobsRead`,
   `notesRead`), counts as a private read (ADR-0037), and doesn't read `hyper://private/`.
   guide:dashboard teaches Query, the sources and the @ functions (`genuiLivePrompt()`, taken from
   lang-core's own text). Like the other dashboard capabilities it is personal, so the sidebar, the
   phone's panel and the loopback MCP have it, and Jobs don't.

Not built: Mutations (a card that writes), `$state` bindings, and the phone drawing live cards. A
Job that writes a card of its own can make it live with `Query("jobRuns", {job: …})`.
