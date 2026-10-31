# The phone can ask the user's computers to update and restart

**Status: Accepted.** 2026-10-31.

The phone updates itself from GitHub Releases (`mobile/lib/updater.ts`). The computer updates on its
own once a day, and only installs on the next restart, so after the phone updates the two often run
different versions for a while. Settings → Devices already flags that. The user wants to fix it from
the phone: update the computer too, and have it restart so it comes back up on the new version
without anyone at the keyboard.

The rules are in `shared/device-updates.mjs`; the computer side is `app/bg/remote-update.js` (with
`downloadUpdateNow` / `installUpdateAndRestart` in `app/bg/browser.js`); the phone side is
`mobile/backend/lib/vault-apps.mjs` (`deviceUpdates`, `requestDeviceUpdate`),
`mobile/lib/deviceUpdates.ts`, `mobile/components/DesktopUpdateBanner.tsx`, and the Devices and
Settings screens.

## Decision

1. **A request and a status, both Vault records.**
   `/.vault/update-requests/<deviceKey>.json` `{ type: 'nomad/update-request', device, version, prerelease, requestedAt, by }`
   is written by the phone for one computer. `/.vault/update-status/<deviceKey>.json`
   `{ type: 'nomad/update-status', device, state, version, requestedAt, by, error, at }` is written by
   that computer as it goes: `checking`, `downloading`, `restarting`, then `updated` (after it comes
   back), or `current`, `failed`, `off`, `unsupported`. This is the same shape as a Job's "run now"
   request (ADR-0030): it works whether or not the AI Bridge is connected, and the phone can follow
   progress by reading the Vault.
2. **Only the user's own Devices can ask.** The Vault's writers are exactly the user's linked
   Devices, so nobody else can write a request into it. The computer also drops a request from a
   Device the Vault no longer lists (one removed after writing it), one that names itself, and one
   older than an hour, so a laptop that slept through a request doesn't restart by surprise when it
   wakes. It takes each request once and deletes it.
3. **The computer can say no.** Settings → General → Auto Updater → "Let my other devices update and
   restart Nomad" (`remote_update_enabled`, on by default). With it off, the computer answers `off`.
   A build that can't update itself (Linux, run from source) answers `unsupported`.
4. **Restart is real and announced.** The computer downloads with the built-in updater (taking
   prereleases when the phone runs a beta or has Beta releases on), shows a system notification
   naming the Device that asked, waits 15 seconds, and calls `quitAndInstall(silent, forceRunAfter)`
   so it relaunches on every platform. Session restore brings the windows and tabs back. On the next
   start it writes `updated` (or `failed`, if the version didn't change) and its new version on its
   Device record.
5. **Where the phone offers it.** A banner right after the phone updated itself, when a computer runs
   an older version; an "Update and restart" link under that computer in Devices; and a "Your
   computers" list in Settings.

## Consequences

- No new wire format or RPC: two record kinds in the Vault, read the same way on both platforms.
- A computer that is off or asleep gets the request only within the hour; after that it updates on
  its own daily schedule, and the phone can ask again.
- The phone can't update another phone. The request names any Device, but only desktop acts on it.
