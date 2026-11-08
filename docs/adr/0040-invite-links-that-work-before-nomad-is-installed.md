# Invite links: one https link that brings a friend onto Nomad

**Status: Phase 1 built** 2026-11-08 (Space invites, with the changes in *Amendment: Phase 1 as built*). Proposed 2026-11-02. Builds on ADR-0029 (Shared Spaces), ADR-0031 (Personas and
Sessions), ADR-0036 (Persona Inbox, proposed), ADR-0045 (Vouches) and ADR-0038
(the always-on Peer, proposed). Amends ADR-0029 §4 (a Space invite can expire) and ADR-0036 §4 (a
sealed frame can carry an invite id) and §2 (a Persona's `sign` key can exist before its Inbox is
turned on). Settles ADR-0038's open item "a web view through a Peer" for now: not yet (§9).

Every social feature Nomad has or is adding assumes the other person already runs Nomad. A Shared
Space invite is a z32 code. A message link is `nomad://messages/new?…`, which only opens inside
Nomad. A Vouch (ADR-0045) needs the guest to have a Persona. A friend who gets any of these by text can't do
anything with it, and nothing tells them what Nomad is or where to get it.

This ADR adds an **Invite link**: an ordinary `https://` link that opens anywhere, says who sent it
and what it's for, gets the friend to the download, and hands the invite to Nomad once it's there.
Everything the invite carries is in the URL fragment, so the site that serves the page never sees
it, and no server of ours is involved.

## Where things are today

- **Shared Space invites** (ADR-0029 §4, built) are single-use blind-pairing codes. The code reveals
  nothing until an owner approves the join, and the role is kept with the invite's public key in the
  minting Device's `space_invites` setting (`app/bg/hyper/space-library.js` `createInvite`). Joining
  is **Join a shared Space** in My Library → Sharing and the phone's Space switcher, where the
  person types or pastes the code. Invites never expire.
- **The Persona Inbox** (ADR-0036) is proposed, not built. Its message link carries the mailbox and
  box keys; a Persona's `sign` key is derived from an inbox seed in the Vault and published in the
  Profile Drive once the Persona has sent a Message.
- **Links from outside Nomad.** Desktop opens `http(s)` and, if the user ticked it in Settings,
  `hyper://` links from the OS (`app.on('open-url')`, `handleArgv` in `main.js`), each as a new tab.
  The phone registers no link handler: `mobile/app.json` has only the Expo scheme
  (`to.holepunch.bare.expo`), so a link to anything opens in another browser.
- **First run.** Desktop has `nomad://setup`; the phone has an onboarding with a Persona step
  (`personaStep` in `mobile/app/index.tsx`). Neither knows about invites.
- **nomad.dev** is a static Astro Starlight site on Cloudflare Pages (`nomad.pages.dev`), with no
  analytics or third-party scripts. It can't read a drive.
- **The phone's HTTP gateway** (`mobile/backend/lib/http-gateway.mjs`) binds 127.0.0.1, one port per
  drive. It's a shim for the WebView, not something a friend's browser can reach.
- **Distribution.** Desktop builds for macOS and Linux and the Android AAB/APK go to GitHub Releases
  (`docs/releasing.md`). There's no iPhone app.

## Decision

### 1. Words

- An **Invite** is one offer from the user to one person: message me, join this Space, or both. It
  has an `id`, an expiry, and is used up by the first person who accepts it.
- A **Profile link** is the reusable kind: for a bio, an email signature or a business card. It
  offers messaging only, and whoever uses it lands in Requests (ADR-0036 §3).
- An **Invite link** is the `https://` form of either one. **Accepting** is what the friend does in
  Nomad; **using up** is what the inviter's Devices record when the first accept arrives.

### 2. The link

```
https://nomad.pages.dev/invite/#<base64url(payload)>
```

The payload is compact-encoded (`shared/invites.mjs`, one golden fixture so desktop, phone and the
page agree byte for byte):

| Field | Present | What it is |
|---|---|---|
| `v` | always | `1` |
| `kind` | always | `invite` or `profile` |
| `id` | always | 16 random bytes; the inviter's Devices know it (§5) |
| `expiresAt` | `invite` | 14 days after it's made; the user can pick 1, 7 or 30 |
| `from` | with a Persona | the inviter's Profile Drive key |
| `name` | with a Persona | the Persona's title at the time, at most 64 characters |
| `mailbox`, `box` | with messaging | the message-link keys (ADR-0036 §3.1) |
| `space` | with a Space | `{ code, name, role }`: the blind-pairing invite, the Space's name and Can view / Can edit |
| `sig` | with a Persona | Ed25519 by the Persona's `sign` key over `'nomad/invite/v1' ‖` everything above |

- **The fragment never leaves the browser.** Browsers don't send it in the request or the
  `Referer`, so Cloudflare sees a request for `/invite/` and nothing else.
- **A few hundred bytes** with everything in it, so a link of roughly 400 to 600 characters. It's long but
  copies and pastes like any other, and fits a QR code at medium error correction.
- **No picture.** A thumbnail would double the link for something the page can't check anyway.
  Nomad shows the real picture after it has checked the Profile Drive (§4).
- **No Persona, no signature.** Someone with no Persona can still send a Space-only invite. It
  carries no `from`, `name` or `sig`, and both the page and Nomad say who it's from in the only
  honest way: they can't tell (§4).

### 3. The page on nomad.pages.dev

`src/pages/invite.astro` in nomad.dev: a standalone page (not a Starlight doc, no sidebar), marked
`noindex`. A short inline script decodes the fragment and shows:

- **Who and what.** *"Ilya invited you to Nomad"* (or *"Someone invited you to Nomad"*), then what
  accepting does: *"Message Ilya"*, *"Join the Space Family. You'll be able to edit."* The name is
  followed by *"Nomad checks this when you open the invite."* The page can't check a signature
  against a Profile Drive it can't read, so it never says the invite is genuine.
- **What Nomad is,** in two sentences, with a link to the site.
- **Downloads** for the visitor's platform first (macOS, Linux, Android APK, all from the latest
  GitHub Release), and *"Not on iPhone yet"* for iOS. Each download button copies the invite link
  to the clipboard first and says so, for the step after install (§4).
- **Already have Nomad? Open the invite.** On Android this is the same https link (App Links do the
  rest). On desktop it's a `nomad-invite:` link (§4).
- **Expired** and **can't read this link** states, in words.

Rules for the page, because anything running on it can read the fragment: no third-party script,
no analytics, no fonts or images from another origin, and a `Content-Security-Policy` in
`static/_headers` that allows only the page's own script. The decoder is the same code as
`shared/invites.mjs`'s decode, copied into the page at build time so they can't drift.

### 4. Getting the invite into Nomad, and accepting it

**Into Nomad:**

- **Phone, with Nomad installed:** Android App Links. nomad.pages.dev serves
  `/.well-known/assetlinks.json` for the package and the release keystore's SHA-256 fingerprint, and
  `mobile/app.json` gets an `autoVerify` intent filter for `https://nomad.pages.dev/invite/`. Tapping
  the link anywhere opens Nomad on the accept screen, fragment included. Inside Nomad's own WebView,
  `routeLink` (`mobile/lib/webLinks.ts`) sends `/invite/` links to the same screen.
- **Desktop, with Nomad installed:** Nomad registers one narrow OS scheme, `nomad-invite:`
  (electron-builder `protocols`, and `setAsDefaultProtocolClient('nomad-invite')` on start). The
  page's **Open the invite** button is `nomad-invite:<payload>`. `open-url` and `handleArgv` pass it
  to the accept prompt and nowhere else: it never becomes a tab URL and never reaches
  `nomad://`. Navigating a tab to an `https://nomad.pages.dev/invite/#…` URL, by pasting it or
  clicking it on a page, opens the same prompt instead of the page (`loadURL` and `onWillNavigate` in
  `ui/tabs/pane.js`, where Names resolve, ADR-0018).
- **Just installed:** there's no deferred deep link; that needs a server that remembers the click
  and fingerprints the install. First run (`nomad://setup`, the phone's onboarding) offers **I have
  an invite**, which reads the clipboard only when tapped, and takes a pasted link or a QR scan on
  the phone.

**Accepting.** The accept prompt is one screen, and nothing in it happens without a click:

1. **Check it.** Decode, check `expiresAt`, then load the inviter's Profile Drive and verify `sig`
   against its published `inbox.sign`. The prompt shows the Profile Drive's real title, picture and
   drive key, the way the login prompt names a site (ADR-0031 §7.3). A `name` that differs from the
   title is shown as *"The link says Ilya. Their profile says Ilya K."* A bad signature drops the
   invite with *"This invite has been changed. Ask for a new one."* A drive that can't be reached
   yet shows *"Couldn't check yet"*, keeps trying while the prompt is open, and allows only the Space
   part (whose owner approves anyway, ADR-0029 §4). An unsigned invite says *"This invite isn't
   signed. Join only if you know who sent it."*
2. **Make a Persona** if there's none: the New Persona form inline (ADR-0031), since a reply and a
   Vouch both need one. Skippable for a Space-only invite, as joining a Space doesn't need a Persona
   today.
3. **Say hello** (with messaging). A first Message from the chosen Persona, pre-filled with *"Hi,
   it's Sam"* and editable, sent with the invite `id` in its sealed frame (§5). Both sides are
   Contacts once it's delivered.
4. **Join the Space** (with a Space). The usual join with the code (`spaceLibrary.join`), with the
   Persona's `profileUrl` in the request. The owner's approval prompt says *"Sam, from your invite,
   wants to join Family"* because the code matches an invite this Device made for a link (§6).

### 5. On the inviter's side

Invites are Vault records, so every Device of the user knows them:

```
/.vault/invites/<id>.json
  { type: 'nomad/invite', id, kind: 'invite' | 'profile', personaId?, space?: { space, invite },
    label?, createdAt, expiresAt?, usedAt?, usedBy?: profileUrl, revokedAt? }
```

- **The hello lands in the inbox.** ADR-0036 §4's sealed frame gains `invite?: id` next to
  `replyTo`. The frame, not the Message, because it's private to the two of them and means nothing
  to any other app. `classify` (ADR-0036 §10) gets the user's invites: a frame whose `invite` is an
  open, unexpired `kind: 'invite'` record goes to the inbox, makes a Contact, and uses the invite up
  (`usedAt`, `usedBy`). A used, expired or revoked one, or a `profile` id, is treated like any
  message-link sender: Requests. Two Devices racing on one invite both write `usedAt`; the earlier
  one wins on merge, and the later sender lands in Requests.
- **The inviter hears about it.** *"Sam accepted your invite."* (an OS notification like a Message
  from a Contact, `inbox_notify`), with **Message** and **I've had them over** (ADR-0045) beside it.
  Nothing is vouched automatically.
- **Invites are listed** in My Library → Personas → Invites (and the phone's Personas screen):
  label, kind, sent, expires, used by, **Revoke**. Revoking marks the record; the mailbox and box
  keys in the link still reach the user until **Change inbox address** (ADR-0036 §3.1), which the
  Revoke confirm says in one line.
- **The `sign` key comes first.** Making a signed invite needs the Persona's inbox seed and a
  published `inbox.sign` (ADR-0036 §2, §3.3). So making one does what sending a Message does:
  make the seed if there's none, publish `inbox.sign`, and start answering the mailbox for Contacts.
  This lets Phase 1 (§10) sign Space invites before the rest of the Inbox is built: the seed and
  `inbox.sign` are built first and the mailbox later.

### 6. Space invites become links

- **Invite by link** in My Library → Sharing, next to the code. It makes the blind-pairing invite
  as today, then the Invite link around it, from the Space's Persona (ADR-0031 §4) if there is one.
  The code stays available for people who already have Nomad.
- **Space invites can expire.** `space_invites` entries gain `expiresAt` (14 days for a link, none
  for a bare code, as today), and `createInvite` drops expired ones before matching a join. This
  amends ADR-0029 §4.
- **Only the Device that made it approves it,** as today, because the blind-pairing invite lives in
  that Device's settings. The Invites list says which Device that is, so the user knows to have it
  on.

### 7. Who can make one, and from where

- **Desktop:** My Library → Personas → **Invite someone** (messaging, with a Space optional), My
  Library → Sharing → **Invite by link** (a Space, with messaging if there's a Persona), and site-info
  on the user's own Profile Drive → **Copy profile link**. The dialog shows the link, a QR code, and
  **Copy**.
- **Phone:** the Personas screen → **Invite someone**, which opens the Android share sheet with the
  link, and **Show QR**. Space invites from the phone wait for ADR-0029's "inviting from the phone".
- **Not the AI.** No capability makes or accepts an invite. An invite lets a person into the user's
  Inbox or a Space, and that stays a click by the user.
- **Not pages.** No public API makes, reads or accepts invites, so the sync triad doesn't apply.

### 8. What each party learns

| Who | Learns | Doesn't learn |
|---|---|---|
| Cloudflare / nomad.pages.dev | that someone loaded `/invite/` (IP, user agent) | anything in the fragment: who, which Space, the keys |
| Anyone the link is forwarded to | everything in it: the name, the Space's name and role, the message-link keys | anything more until the owner approves a join or the user accepts their hello |
| The friend, before accepting | the inviter's claimed name, then the real Profile Drive | the inviter's Devices or addresses |
| The inviter | the friend's Persona and Profile Drive (in the hello or the join request) | anything the friend didn't send |

A forwarded personal invite is a real risk, the same as a forwarded Space code today: the first
person to accept uses it. The Space join still needs the owner's click, and the hello names the
Persona that sent it, so the inviter sees who actually came in.

### 9. A web view of the profile: not yet

A friend would trust an invite more if they could see the inviter's real profile, or read their
blog, before installing anything. That needs a server that holds the Profile Drive and renders it
over https: a hosted gateway run by the project, or the user's own always-on Peer (ADR-0038
"Still open"). Both are left out of this version:

- A hosted gateway makes the project run a service that serves arbitrary user content, with the
  abuse and takedown work that brings, and makes a Profile Drive crawlable. ADR-0031 keeps a Profile
  Drive readable by people who have its URL, which isn't the same as the open web.
- A self-hosted one on a Peer needs a domain, TLS and an open port, which few people will set up.
- The always-on Peer does more for invites as the Inbox relay (ADR-0038 §7): a friend who accepts at
  midnight gets their hello delivered while the inviter's laptop sleeps.

If it comes back, it's opt-in per Persona and served from a separate origin. Its own ADR.

### 10. Code layout

- `shared/invites.mjs`: the payload encode and decode, the signed bytes, the expiry rules, the
  record path, and `inviteDecision(frame, invites, now) → 'inbox' | 'request'`. Pure, crypto from the
  caller. Tests `tests/unit/invites.test.js`, with a golden payload.
- `app/bg/hyper/invites.js` (desktop): make, list, revoke, accept; the `nomad-invite:` and
  `/invite/` intercepts call into it. The accept prompt is a modal, `app/fg/modals/invite.js`.
- The Inbox side (`app/bg/hyper/inbox.js`, `mobile/backend/lib/inbox.mjs`) reads `invite` off the
  frame and calls `inviteDecision`.
- `mobile/components/Invite.tsx` (the accept screen, an entry in `screens`), the App Link intent
  filter in `mobile/app.json`, the Personas screen's Invites, `RPC_APPS` `invites`.
- nomad.dev: `src/pages/invite.astro`, `static/.well-known/assetlinks.json`, the CSP in
  `static/_headers`, and a user page *Inviting someone* under Personas.

## Considered options

- **A hosted read-only gateway for Profile Drives** (§9). The best preview, but a service the
  project runs, a content policy, and profiles on the open web. Later and opt-in, if at all.
- **A gateway on the user's own Peer** (§9). Best privacy, but few users can expose one. The Peer is
  more useful as the Inbox relay.
- **Hypercore in the friend's browser** over a WebSocket relay. Shows the real profile peer to
  peer, but needs a relay anyway and a large page, for the least gain. Rejected.
- **Deferred deep links** (the invite survives the install untouched). Needs a server that
  remembers who clicked and matches the install by fingerprint. Rejected; the clipboard after an
  explicit tap is enough.
- **Put the invite in the query string.** Then it's in Cloudflare's logs and every `Referer`.
  Rejected; the fragment costs nothing.
- **Register `nomad://` or `hyper://` with the OS for this.** `nomad://` reaches internal pages
  with their own trust (`nomad://settings`, `nomad://library`), and `hyper://` is a setting the user
  controls and may have off. A scheme that does one thing is easier to keep safe.
- **Sign with the Profile Drive's key.** An Autobase Profile Drive has no single key; its writers
  are the user's Devices (ADR-0031 §5). The Persona's `sign` key is the one stable signing key a
  Persona has.

## Consequences

- A Shared Space invite becomes something a person without Nomad can act on, and that a person with
  Nomad opens in one tap instead of copying a code.
- Messages (ADR-0036) and Vouches (ADR-0045) get a way in for the second person. A personal invite
  skips Requests, so the first conversation isn't a stranger's request.
- nomad.dev gains a page whose contents are private by construction, and a rule that keeps it that
  way: no third-party script on `/invite/`, ever.
- The phone gets its first App Link, tied to the site's domain and the release keystore. Moving the
  site or rotating the keystore breaks it until `assetlinks.json` is updated.
- Desktop registers a new OS scheme, `nomad-invite:`. Any web page can launch it; the most it does
  is open the accept prompt.
- The Persona's `sign` key and `inbox.sign` ship before the rest of the Inbox.

## Still open

- **The domain.** App Links bind the phone to the host for good. `nomad.pages.dev` works today; a
  custom domain should come first if one is planned. Decide before Phase 2's phone step.
- **Play Store.** The page links the APK on GitHub Releases. When Nomad is on the Play Store, the
  Android button goes there, and App Links keep working with the same keystore.
- **iPhone.** Universal Links when there's an app.
- **Groups.** One link for several people (an event, a class) would be several invites or a
  `profile` link plus a Space; left until someone needs it.

## Rollout

**Phase 1, Space invites (needs nothing unbuilt):**

1. `shared/invites.mjs` with tests and the golden payload; CONTEXT.md entries (Invite, Profile link,
   Invite link).
2. The Persona inbox seed and published `inbox.sign` (ADR-0036 §2), so links are signed.
3. nomad.dev: `/invite/` with the CSP, and the user page.
4. Desktop: **Invite by link** in Sharing, Space invite expiry, the `nomad-invite:` scheme and the
   `/invite/` intercept, the accept modal, **I have an invite** in `nomad://setup`.
5. Phone: `assetlinks.json` and the intent filter, the accept screen, **I have an invite** in
   onboarding.

**Phase 2, with the Persona Inbox (after ADR-0036's desktop step):**

6. `invite` in the sealed frame and `inviteDecision` in `classify`; the hello in the accept prompt.
7. **Invite someone** and **Copy profile link**, the Invites list, *"Sam accepted your invite"*.
8. Phone: the Personas screen's Invites and share sheet.

**Later:** the hello rides the always-on Peer's Inbox relay (ADR-0038 §7) with no change here.

## Amendment: Phase 1 as built (2026-11-08)

Space invites are links on desktop and the phone. What changed from the plan above:

1. **Any of the user's Devices approves.** §6 kept the blind-pairing invite in the minting Device's
   `space_invites` setting, so only that Device could approve. A link's invite is a Vault record
   instead (`/.vault/invites/<id>.json`, `makeInviteRecord` in `shared/invites.mjs`), holding the
   blind-pairing public key, the role, the Space Library and the expiry. Every Device that manages
   the Library listens for joins and matches a candidate against the open records
   (`openInvitesFor`): desktop's `_matchable` in `app/bg/hyper/space-library.js`, the phone's
   `mobile/backend/lib/invites.mjs`. The first approval marks it used (`markUsed`, the earlier
   `usedAt` wins); a join another Device already approved is answered without asking again, since
   its member record is there. A bare code (**Make a code instead**) stays in the setting and only
   its Device approves it, as before.
2. **The accept prompt is My Library → Sharing.** An invite link from the OS scheme, a tab
   navigation or the address bar opens `nomad://library/sharing#invite=<payload>`
   (`acceptUrlFor` in `app/bg/hyper/invites.js`). The page reads it with the internal
   `nomad.vault.readInvite`, shows who it's from and the signature check, and joins on **Join**. The
   fragment never leaves the page, and nothing happens without the click. The phone opens the
   Space switcher's join form with the link filled in; the form shows the same check
   (`invites/read`) before **Join**.
3. **No App Links yet.** `autoVerify` needs the release keystore's fingerprint in
   `/.well-known/assetlinks.json`, which isn't settled. The phone registers the `nomad-invite`
   scheme and the `https://nomad.pages.dev/invite` path as plain intent filters (`mobile/app.json`),
   so Android asks which app opens one; `app/+native-intent.tsx` keeps the router out of it.
   Inside Nomad, `routeLink` sends both to the join form.
4. **Inviting from the phone.** The Space switcher's edit view has **Invite people** for a shared
   Space (`InviteSheet.tsx`): make a link for Can edit or Can view and 1, 7, 14 or 30 days, send it
   with Android's share sheet, approve or deny who's waiting, and revoke an unused link. A join to
   a Space the phone manages notifies (`useInviteJoins.ts`); so does one on desktop
   (`notify_space_notices`).
5. **Signed when there's a Persona.** The link is signed by the Space's Persona (its own, else the
   default) when that Persona is usable and its Profile Drive has a title, which becomes the link's
   `name`. Signing makes the inbox seed and publishes `inbox.sign` (`signInvite` in
   `shared/inbox-engine.mjs`). With no such Persona the link is unsigned, and every screen that
   shows it says so.
6. **Not built:** **I have an invite** in first-run setup (the link opens Sharing or the join form
   once Nomad is installed, which covers it), QR codes (no QR library in userland yet), and all of
   Phase 2.

