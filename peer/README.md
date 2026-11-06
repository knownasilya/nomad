# nomad-peer

An always-on Peer for Nomad ([ADR-0038](../docs/adr/0038-an-always-on-peer.md)). Run it on a machine
that stays on, like a NAS, a home server, a Raspberry Pi or a small VPS. It keeps a full copy of your
Spaces online, so your devices sync through it while your computers sleep, and the people you share a
Space with can reach it too.

It can read what it keeps. It can't change anything: it is no drive's writer and doesn't write your
Vault. Use disk encryption on the machine it runs on.

## Run it

From a checkout of this repo, with Node 20 or newer:

```sh
cd mobile && npm install && cd ..
# On a computer with Nomad: Settings → Devices → Add an always-on Peer, then:
node peer/index.mjs join <invite-code> --name "Home NAS"
# Approve the request in Settings → Devices, then:
node peer/index.mjs run
```

Keep `run` going as a service (systemd, a Docker restart policy, or similar). Check on it with
`node peer/index.mjs status`. Every command takes `--dir <folder>`; the default is `~/.nomad-peer`,
or `$NOMAD_PEER_DIR`.

## What it keeps

Your devices decide, in Settings → Devices (or Devices on the phone): by default the Vault, every
Space with its Space Library and the drives in its Drive Registry, and your Personas' Profile Drives.
Turn a Space off there and the Peer stops serving it.

## Removing it

Remove the Peer in Settings → Devices. It sees that, stops, and deletes its folder. A Peer that has
been stolen keeps what it had already copied. To stop it by hand, run `node peer/index.mjs leave --yes`,
then remove it in Settings → Devices too.
