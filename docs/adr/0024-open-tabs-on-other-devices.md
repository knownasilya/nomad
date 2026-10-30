# Each Device shares its open tabs, per Space, through the Vault

**Status: Accepted.** 2026-10-30.

The user wants a Space's open tabs to follow them between Devices: start reading on the laptop,
pick it up on the phone. We do it the way Chrome's "Tabs from other devices" does: every Device
publishes the tabs it has open, and the others list them. The rules are in `shared/open-tabs.mjs`;
desktop is `app/bg/ui/open-tabs.js` and nomad://history; the phone is `mobile/backend/lib/vault-apps.mjs`
and the tab grid (`mobile/app/tabs.tsx`).

## Decision

1. **One record per Device, in the Vault**: `/.vault/tabs/<deviceKey>.json`
   `{ type: 'nomad/open-tabs', device, updatedAt, spaces: [{ rootDriveKey, name, tabs: [{ url, title, pinned?, active? }] }] }`.
   Only the Device it names writes it, so two Devices never overwrite each other and no merge is
   needed. Spaces are keyed by Root Drive key, which is the same on every Device that shares the
   Space.
2. **Read-only elsewhere.** Other Devices show these tabs and open one in a new tab on tap. They
   never open, close or reorder tabs on their own. Mirroring tabs both ways would close a tab on the
   laptop because the phone closed it, and two Devices with different tabs open would fight.
3. **Only pages another Device can open**: http, https and hyper://. Not nomad:// pages or the new
   tab page, not file://, and not `hyper://private/`, which names this Device's own copy of the
   Space's Root Drive. Capped at 200 tabs per Space and 50 Spaces.
4. **Cheap on the Vault's log.** A Device writes five seconds after its tabs settle, only when
   something another Device would see changed (titles and URLs, not the time), only once another
   Device has joined the Vault, and never makes a Vault to do it. Not carried when a solo Vault joins
   another: the record belongs to the Device. Removing a Device deletes its record; readers also skip
   any record whose Device is no longer listed.
5. **Per-Device opt-out.** `sync_open_tabs` (desktop, Settings → Devices) and the phone's Settings
   switch. Off deletes this Device's record. It is not a synced setting: sharing is each Device's
   choice.
6. **Where they show.** Desktop: nomad://history → Tabs From Other Devices (`#devices`), by Device
   then Space, the page's own Space first. Phone: under the tab grid, "On your other devices".

## Consequences

- The phone keeps a Space's tabs in memory only, so it publishes the Spaces it has opened since
  launch. Its default Personal Space isn't shared yet (a separate gap), so its tabs show under the
  phone's own "Personal", not the desktop's.
- Titles and URLs of open tabs replicate to every linked Device, the same audience as Notes and
  Reader subscriptions.
