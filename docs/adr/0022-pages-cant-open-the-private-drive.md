# Pages can't open the private drive, except one path the user allows, for one hour

**Status: Accepted.** 2026-10-12. Built.

The Root Drive of every Space (`hyper://private/` in that Space) holds the user's address book, AI
chat sessions and drive list. Before this decision a page could read all of it: the Hyperdrive
backend let any `hyper://` page through ("Sidebar & ai", #10), the Autobase backend had no read
check at all, and the serve path and that check knew only the default Space's root. The rules are in
`app/bg/web-apis/bg/private-drive-guard.ts`; `private-drive-access.ts` wires the one instance that
`fs.ts` and `hyperdrive.ts` share.

## Decision

1. **Closed by default.** A page that is not Nomad's own UI (`nomad://`, trusted) and is not served
   from that same private drive gets an error from every `nomad.fs` call on it, on both backends.
   `filesystem.isRootUrl` knows the root of every Space, so this holds in all of them.
2. **One path per grant.** The first read or write of a path asks the user, and the prompt names the
   path (`privateRead:<path>`, `privateWrite:<path>`). A file grant covers that file. A folder grant
   (a path that ends in `/`) covers the folder and everything below it. A read grant does not allow
   a write; a write grant also allows a read. A grant belongs to one site and one Space's drive.
3. **A grant ends after one hour.** Grants live in memory, so quitting Nomad ends them all. They are
   not stored in `sitedata`, which keeps only allow or deny with no path and no end time.
4. **Never granted:** the root `/`, a path with `..` or other tricks, and any call on the whole drive
   (`getInfo`, `watch`, `query`, `forkDrive`, `configure`, writer management, Draft Mode). These fail
   at once, with no prompt.
5. **The serve path agrees.** A sub-resource request to a Space's root by its real key is blocked
   unless it comes from a `nomad://` page or from that drive itself, as `hyper://private` already
   was. Every Space's root gets no CORS header.
6. **Apps ask for what they need instead.** The blog and forum templates read
   `/address-book.json` to find the user's profile. They now ask with the drive picker
   (`nomad.shell.selectDriveDialog({ tag: 'contact', writable: true })`) and keep the URL.

## Considered options

- **Keep the `hyper://` exception and add a prompt for the whole drive.** Rejected: one "Allow"
  would open the address book, chat sessions and drive list together, for good.
- **Store grants in `sitedata` like other permissions.** Rejected for now: it has no path and no end
  time, and a grant that outlives a restart is the opposite of what the user asked for.
- **Let the page choose how long a grant lasts.** Rejected: the page would always ask for the
  longest. A choice in the prompt can come later.

## Consequences

- A drive app that built on the private drive breaks until it asks for a path, or better, stores
  its data elsewhere (its own drive, a drive the user picks, or `localStorage`).
- The user can't yet see or end a grant before its hour is up.
- The Vault, which holds Notes, Names, Highlights and Drafts, is a separate drive and is not covered
  by this guard. A page can't learn its key today, but nothing stops a page that knows it.
- The phone's backend has its own `nomad.fs` dispatcher and is not covered by this change.
