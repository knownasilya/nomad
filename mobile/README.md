# Nomad (mobile)

A peer‑to‑peer **companion browser** for mobile, built with **Pear v2 / Bare** on top of the
[`bare-expo`](https://github.com/holepunchto/bare-expo) template.

> **Design:** the UI is a mobile-friendly take on [nomad](../nomad)'s desktop browser chrome —
> the same token system (blue brand accent, neutral grays, secure/untrusted trust colors), ported
> to a touch layout in [`lib/theme.ts`](lib/theme.ts) and following the system light/dark scheme.

It is a normal tabbed browser for the web **and** a viewer for `hyper://` content —
files served directly from a peer's machine over the [Hyperswarm](https://github.com/holepunchto/hyperswarm)
DHT, with **no servers in between**. Two drive formats are supported behind `hyper://`:

| Pill | Drive type | What it is |
|------|-----------|------------|
| **HD** | [Hyperdrive](https://github.com/holepunchto/hyperdrive) | single‑writer P2P filesystem |
| **AB** | [Autobase](https://github.com/holepunchto/autobase) drive | multi‑writer drive — a Hyperdrive materialized from an Autobase view |

## How it works

React Native's JS engine (Hermes) can't do UDP or the low‑level networking P2P needs, so all
peer‑to‑peer work runs in a **Bare worklet** — a separate native thread. The UI and the worklet
talk over an RPC channel:

```
┌────────────────────────────┐         RPC over IPC          ┌────────────────────────────┐
│  React Native UI (Hermes)  │  ───────────────────────────► │   Bare worklet (backend)   │
│                            │   RPC_OPEN { url, driveType } │                            │
│  • tabs / address bar      │                               │  • Corestore + Hyperswarm  │
│  • WebView for http(s)     │ ◄─────────────────────────────│  • Hyperdrive / Autobase   │
│  • HyperView for hyper://  │   RPC_CONTENT / RPC_STATUS /  │    drive resolver          │
│                            │   RPC_ERROR                   │  • reads files & dirs      │
└────────────────────────────┘                               └────────────────────────────┘
```

- **Web pages** (`http(s)://`, or a search term) render in a normal `react-native-webview`.
- **`hyper://` URLs** are sent to the backend, which opens the drive, replicates it over the
  swarm, reads the requested file (or directory), and streams it back. The UI renders HTML/images
  in a WebView and directories as a tappable file list.
- **Sub-resources resolve.** When serving hyper HTML, the backend inlines the page's relative
  images, scripts, and stylesheets (and CSS `url()` refs) from the same drive as `data:` URIs, and
  injects a click-bridge so in-page relative links navigate back through the backend.
- **Markdown is rendered.** `.md` files (including a drive's `index.md`) are rendered to a styled,
  theme-aware HTML page — with relative links/images resolved like any other page.
- **Tab titles** come from the drive: `index.json` `title`, else `index.html`'s `<title>`, else
  `index.md`'s first `#` heading; otherwise the short key.

### Browser features

- **Tabs** that stay alive in the background (page state is preserved when switching).
- **Per-tab back / forward** across home, web, and hyper pages, plus a home button.
- **Bookmarks & history** persisted with AsyncStorage — tap ☆ to bookmark; the home screen lists
  bookmarks and recent visits, tappable to reopen (long-press a bookmark to remove it).

### `hyper://` address forms

```
hyper://<key>/path/to/file      # explicit
hyper://<key>                    # → index.html, else index.md, index.txt, else lists the root
<key>/path                       # scheme optional
```

`<key>` is a 52‑char z‑base‑32 key or a 64‑char hex key. A drive is either a Hyperdrive or an
Autobase (collaborative) drive — fixed when it is created, but a `hyper://` key doesn't say which.
So the backend **tries both** (opening the wrong structure throws or yields an empty root, so a
file / non‑empty dir is the signal) and uses whichever resolves. The detected type is shown in the
read‑only **HD / AB** badge and remembered in **My Library**, so the next visit tries it first.

### Menu, My Library, and DevTools

The `☰` button opens a menu: **My Library**, **Developer tools**, **Copy link**, **Reload**.

- **My Library** — a hub with four pages: **Hyperdrives**, **Bookmarks**, **History**,
  **Downloads** (mirroring nomad's library). On the Hyperdrives page you **create** a new drive
  (name + Hyperdrive/Collaborative) — like nomad's `createNewDrive`, the backend generates a
  keypair and assigns it a `hyper://` URL; the drive is yours (writable) and reopens writable via a
  stored namespace. Drives you visit are listed read‑only.
- **Developer tools** — an in‑app inspector for the active tab: a live **Console** (page
  `console.*` + errors, captured via an injected shim) and **View source**. WebViews also run with
  `webviewDebuggingEnabled`, so full DevTools are available over `chrome://inspect` (Android) or
  Safari ▸ Develop (iOS).

## Project layout

```
mobile/
├── app/
│   ├── _layout.tsx          # expo-router root (SafeAreaProvider, no header)
│   ├── index.tsx            # the browser: tabs, address bar, web + hyper rendering
│   └── app.bundle.mjs       # generated — the packed Bare backend (npm run bundle)
├── components/
│   ├── TabStrip.tsx         # tab bar
│   ├── AddressBar.tsx       # omnibox + read-only HD/AB drive-type badge
│   ├── Library.tsx          # My Library overlay (drives / bookmarks / history / downloads)
│   ├── DevTools.tsx         # in-app console + view-source for the active tab
│   └── HyperView.tsx        # renders hyper:// files / images / directory listings
├── lib/
│   ├── useBackend.ts        # boots the worklet, wires RPC, exposes open()/close()
│   ├── hyperUrl.ts          # address parsing / web-vs-hyper detection
│   └── types.ts             # shared message types
├── backend/
│   ├── backend.mjs          # worklet entry: Corestore + RPC, handles open/close
│   └── lib/
│       ├── drive-manager.mjs # opens/replicates drives, resolves files & dirs
│       └── hyper-url.mjs     # key/path parsing (z32 + hex)
├── rpc-commands.mjs         # shared RPC command IDs + drive-type constants
└── tools/
    ├── publish.mjs          # seed a local folder as a hyper:// drive (for testing)
    └── verify-drives.mjs    # end-to-end test of the resolver over the real DHT
```

## Prerequisites

Per the [Bare mobile guide](https://docs.pears.com/guide/making-a-bare-mobile-app/):

- Node.js
- **Java 23** and **Gradle 8.10.2**, **Android SDK (≥ 29) + NDK** for Android
- **Xcode** for iOS
- A real device or simulator/emulator

## Setup & run

```bash
cd mobile
npm install

# Pack the Bare backend into app/app.bundle.mjs for iOS + Android.
# Re-run this whenever you change anything under backend/ or rpc-commands.mjs.
npm run bundle

# Launch
npm run ios       # or: npm run android
```

## Try it with real content

In a second terminal, seed any folder and keep it online:

```bash
# publish ./site as a Hyperdrive
node tools/publish.mjs ./site

# …or as an Autobase (collaborative) drive
node tools/publish.mjs ./site --autobase
```

It prints a `hyper://…` URL. For a Hyperdrive, paste it into the address bar and Go. For an
Autobase drive, add it in My Library with the Collaborative type, then open it.
Keep the publisher running so the app has a peer to pull from.

## Verifying the P2P core

The drive resolver (`backend/lib/drive-manager.mjs`) is plain JS — only `backend.mjs` itself needs
the Bare runtime — so it can be exercised directly against the real Hyperswarm DHT:

```bash
node tools/verify-drives.mjs
```

This seeds a Hyperdrive **and** an Autobase drive, announces them, and reads them back through the
same `DriveManager` the app uses, asserting file serving and directory listing for both. It should
print `ALL PASSED ✅`.

## Troubleshooting

- **Android build fails with `JvmVendorSpec ... IBM_SEMERU`.** Expo's prebuild can pin Gradle 9,
  which is incompatible with the resolved AGP 8.12. This project pins the Gradle wrapper to
  **8.14.3** via [`plugins/withGradleVersion.js`](plugins/withGradleVersion.js) so it survives
  `expo prebuild`. Make sure `ANDROID_HOME` is set (or `android/local.properties` has `sdk.dir`).

## Notes & limitations

- **Dynamic** sub-resources fetched at runtime by a hyper page's own JS (`fetch`/`XHR` to
  `hyper://`) aren't proxied — only static `img`/`script`/`link`/CSS `url()` refs present in the
  served HTML are inlined. A local content server or custom scheme handler would close that gap.
- **Autobase drive protocol.** "Autobase drive" here means a Hyperdrive whose contents are
  materialized from an Autobase log of filesystem ops (`put`/`del`), defined in
  `openAutobaseDrive()`. Any peer replaying the same `apply()` reconstructs an identical, readable
  drive — the multi‑writer analogue of a plain Hyperdrive.
- Background tabs stay alive (WebViews are kept mounted), so switching tabs preserves page state.
