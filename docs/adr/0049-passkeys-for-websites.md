# Passkeys for websites, kept by Nomad on this computer

**Status: Accepted** 2026-11-21, built as below. Builds on ADR-0033 (Secrets: values on this computer
only, wrapped by the OS keychain) and ADR-0039 (an encrypted Vault, still proposed).

A website asks for a passkey with WebAuthn: `navigator.credentials.create({ publicKey })` to make one
and `navigator.credentials.get({ publicKey })` to sign in. In Nomad neither did anything useful.
Electron implements the content side of WebAuthn but none of the browser's UI (the account picker,
the PIN prompt, the "use a phone" sheet), so on Linux and macOS a request ends with `NotAllowedError`
at once (checked in Electron 45). The macOS system passkeys (iCloud Keychain, through
`ASAuthorizationPlatformPublicKeyCredentialProvider`) need Apple's
`com.apple.developer.web-browser.public-key-credential` entitlement, which needs an Apple Developer ID
and Apple's approval; Nomad is signed with a self-signed certificate (see CLAUDE.md, Releasing). So
Nomad can't hand passkeys to the OS. It can be the authenticator itself, as password managers are.

## Decision

1. **Nomad is a platform authenticator.** The webview preload (`fg/webview-preload/passkeys.js`)
   injects `passkeys-page.js` into the page's main world on https pages and http://localhost. It wraps
   `navigator.credentials.create`/`get`: a call with `publicKey` goes over IPC to
   `bg/ui/passkeys.js`; every other call (passwords, federated, `mediation: 'conditional'`) goes to the
   browser untouched. What comes back is a `PublicKeyCredential` (prototype and all) with the
   `getTransports`/`getAuthenticatorData`/`getPublicKey` helpers and `toJSON()`, so libraries such as
   SimpleWebAuthn work. `isUserVerifyingPlatformAuthenticatorAvailable()` says yes;
   `isConditionalMediationAvailable()` says no (Nomad draws no autofill menu).
2. **Keys stay on this computer.** Each passkey is a P-256 key (ES256, the one algorithm every site
   accepts), made in bg with Node's crypto, kept in `<userData>/passkeys.json` encrypted with
   `safeStorage` like Secrets, and decrypted only to sign (`bg/passkeys/store.js`). Not in the Vault, a
   drive or a Space; the user chose this over syncing while the Vault is plain bytes (ADR-0039 is
   still proposed). The authenticator data says so: BE and BS are 0, a single-device credential.
   Linux's `basic_text` backend counts as no keychain, and the prompt says so instead of saving.
   Revisit syncing once the Vault is encrypted.
3. **bg decides, the page only asks.** bg takes the origin from `event.senderFrame`, never from the
   page. A frame from another origin than the tab's top page gets the browser's own WebAuthn, so an
   embedded site can't sign for the page around it. The RP ID must be the host or a registrable domain
   above it, checked against the Public Suffix List with its private section (`tldts`, as Chromium
   does), so `co.uk` and `github.io` can't be RP IDs. IP addresses can't be either. bg builds
   `clientDataJSON` itself. The ceremonies (`bg/passkeys/ceremony.mjs`) and the bytes
   (`shared/passkeys.mjs`: CBOR, authenticator data, the COSE key, "none" attestation with a Nomad
   AAGUID) have no Electron in them, so tests run them on Node.
4. **The user says yes in Nomad's own prompt.** The `passkey` modal (`fg/modals/passkey.js`, a
   BrowserView over the tab that no page can draw on or press) shows the site and the account: save a
   passkey; sign in (a list when there are several); "this account already has one" (the site gets
   `InvalidStateError`); and "no passkey for this site". Each offers **Use a phone or security key**,
   which hands the request back to the browser's own WebAuthn (the shim calls the native method with
   the page's options). On a Mac with Touch ID, the yes is followed by Touch ID. Elsewhere that click
   is the user verification Nomad reports (UV = 1), as password managers do; a site that asks for
   `userVerification: 'discouraged'` gets UV = 0. A page's `AbortSignal` or its timeout closes the
   prompt. A passkey made for an account Nomad already has (same RP ID and user handle) replaces the
   old one; sign-in counters stay 0, as synced passkeys' do.
5. **Where the user sees them.** My Library → Passkeys (`library/js/views/passkeys.js`, internal
   `nomad.passkeys`: `list`, `remove`, `getStatus`, `watch`; `remove` only from nomad://library) lists
   them by site with when each was saved and last used, and deletes one. No API returns a key.

## Not in scope

- **The phone.** Android's WebView answers WebAuthn only through Credential Manager for apps that
  are Digital Asset Links-associated with the site, or browsers on Google's privileged list. Nomad
  could inject the same shim there and sign in its backend (P-256 in Bare), with these rules from
  `shared/passkeys.mjs`, once passkeys can sync to it.
- **Hyper drives.** A drive app has no server to check a signature, and a hyper:// origin isn't a
  domain WebAuthn allows. Drives keep Personas and Sessions (ADR-0031).
- **Autofill** (`mediation: 'conditional'`), **attestation** other than "none", **extensions** other
  than `credProps`, **cross-origin iframes** (they get the browser's own WebAuthn).
- **The AI.** No capability lists, makes or uses passkeys, and page control can't reach the prompt.

## Tests

`tests/unit/passkeys.test.js`: base64url and UTF-8 against Node's, CBOR, RP ID rules, option checks,
and both ceremonies with real P-256 keys, decoding the attestation object and verifying the assertion
signature. While building it, SimpleWebAuthn's server (v13, `requireUserVerification: true`) verified
a registration and a sign-in made through the page shim in Chromium and in Electron 45 (real IPC,
contextBridge and `senderFrame`), and a cross-origin iframe was handed to the browser's own WebAuthn.
