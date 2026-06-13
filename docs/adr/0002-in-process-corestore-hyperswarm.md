# In-process Corestore + Hyperswarm — no external daemon

We are replacing the Hyperspace out-of-process daemon (managed via `hyperdrive-daemon-client`) with Corestore v6 + Hyperswarm v4 running directly in Nomad's Electron main process. Corestore data is stored in `app.getPath('userData') + '/corestore'`.

## Why

Hyperspace is architecturally frozen — it predates the Pear/Holepunch ecosystem's current module set and is no longer maintained. Running in-process eliminates the IPC layer, the process spawn/reconnect retry loop, and the two competing storage paths (`~/.hyperspace` and `~/.hyperdrive`). Hyperswarm v4 adds relay server fallback, making the "not holepunchable" network warning obsolete.

## Consequences

The `holepunchable` indicator in the browser menu is replaced with relay-vs-direct connection status, which Hyperswarm v4 exposes natively. The `daemon.js` module is deleted; drive session management moves inline to the hyper layer.
