# Releasing

## Cutting a release

**Don't hand-edit version numbers or hand-create the tag.** Use `standard-version`, which keeps the
two desktop manifests, the changelog, the commit, and the tag consistent in one step:

```bash
npm run release-version                        # patch bump (X.Y.Z → X.Y.(Z+1))
npm run release-version -- --release-as minor  # or major, or an explicit 1.2.30
git push --follow-tags origin main             # pushes the chore(release) commit AND the tag
```

`standard-version` (configured by [`.versionrc`](../.versionrc)):

- bumps **`package.json`** and **`app/package.json`** — both must match, because `app/package.json`
  is the manifest the Electron app actually reports (auto-updater / About box); a bump that misses
  it ships a mis-versioned desktop build,
- regenerates **`CHANGELOG.md`** from the conventional-commit history (so write `feat:` / `fix:` /
  etc. commit messages),
- makes the **`chore(release): X.Y.Z`** commit and the annotated **`vX.Y.Z`** tag.

The `--follow-tags` push of the tag is what triggers the workflow below. Because `standard-version`
sets `package.json` to the same version as the tag it creates, the desktop and Android artifacts
always land on one release — no manual sync needed.

## Cutting a beta release

A beta is a release with a prerelease version (`1.22.0-beta.0`). It goes only to people who turned
on **Beta releases**: on desktop in Settings → Auto Updater, on the phone in Settings → Updates.
Everyone else keeps getting the last stable release.

```bash
npm run release-version -- --prerelease beta                     # 1.21.0 → 1.22.0-beta.0 (bump from the commits)
npm run release-version -- --release-as minor --prerelease beta  # or pick the bump yourself
npm run release-version -- --prerelease beta                     # next beta: 1.22.0-beta.0 → 1.22.0-beta.1
git push --follow-tags origin main
```

The tag (`v1.22.0-beta.0`) runs the same workflow as a release. Because the tag has a `-`, both jobs
also mark the draft as a **prerelease**. Check the artifacts and publish the draft as usual; leave
"Set as a pre-release" ticked. A published prerelease is what beta users update to. GitHub's
`releases/latest`, which everyone else checks, never returns one.

When the beta is good, cut the stable release with the same number:

```bash
npm run release-version -- --release-as 1.22.0
git push --follow-tags origin main
```

Beta users get it too, since `1.22.0` is newer than `1.22.0-beta.1`. Turning Beta releases off
doesn't take an app back to the older stable build; it waits for the next stable release that is
newer than the beta it runs.

How each app finds a beta:

- **Desktop:** `auto_update_prerelease` (a global setting) sets electron-updater's
  `allowPrerelease` on every check (`checkForUpdates` in `app/bg/browser.js`). electron-updater then
  takes the newest published release from the repo's releases feed, prerelease or not, and reads
  its `latest-mac.yml`. electron-builder writes `latest-*.yml` for betas too, because it doesn't
  split update channels for the GitHub provider.
- **Android:** with the `hb:updates-beta` preference on, `mobile/lib/updater.ts` reads
  `GET /repos/knownasilya/nomad/releases` instead of `releases/latest` and installs the newest
  version with an APK (`pickNewestRelease` in `mobile/lib/updateRelease.ts`, which orders versions
  the semver way).

A beta and its stable release share an Android `versionCode` (the prerelease part isn't in it).
Android installs an update with an equal `versionCode`, so sideloaded APKs work; the Play Store
would reject the second upload with the same code.

> **Mobile note:** the Android `versionName`/`versionCode` come from the **tag** in CI (see
> [Versioning (Android)](#versioning-android)), so `mobile/app.json`'s `version` is only a local-dev
> fallback and is *not* bumped by `standard-version` — nudge it by hand if you care about the
> local-build version.

## What a tag triggers

Pushing a tag matching `v*` (e.g. `v1.2.3`) triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which runs three build jobs:

| Job | Runner | Output | Uploaded as |
|-----|--------|--------|-------------|
| Build macOS | `macos-latest` | Electron app (self-signed, or Developer ID signed + notarized, if secrets set) | electron-builder artifacts |
| Build Linux | `ubuntu-latest` | AppImage | electron-builder artifacts |
| Build Android | `ubuntu-latest` | AAB + APK from `mobile/` | `nomad-<version>-android.aab` / `.apk` |

All three attach their artifacts to a single **draft GitHub release** for the tag —
electron-builder creates it (its default `releaseType` is draft), and the Android job reuses it or
creates it first if it wins the race. **Publish the draft manually** once you've sanity-checked the
artifacts.

The desktop release is named after `package.json`'s `version`; the Android job keys off the tag. The
`standard-version` flow above keeps them identical, so both land on the same release. If you ever
tag by hand and `package.json` doesn't match, the two sets of artifacts split across separate draft
releases — another reason to use `npm run release-version`.

The AAB is what the Play Store accepts; the APK is what users can sideload directly from the
GitHub release (AABs are not installable).

**Publishing the draft is what ships the phone update.** The Android app checks GitHub's
`releases/latest` (which skips drafts and prereleases) on launch and hourly, and installs the
`nomad-<version>-android.apk` asset when its version is newer than its own (see
[`mobile/README.md`](../mobile/README.md#updates)). So keep that asset name, and keep the
`versionName`/`versionCode` derived from the tag: Android refuses an update whose `versionCode` is
lower than the installed one. Updates only install over a build signed with the same key, which is
why the release keystore below must never change.

## Versioning (Android)

The Android job derives versions from the tag:

- `versionName` = the tag without the `v` prefix (`v1.2.3` → `1.2.3`, `v1.2.3-beta.0` → `1.2.3-beta.0`)
- `versionCode` = `major×1000000 + minor×1000 + patch` (`v1.2.3` → `1002003`; a beta of it gets the same code)

Both are passed to Gradle as environment variables (`NOMAD_VERSION_NAME` / `NOMAD_VERSION_CODE`);
local builds without them fall back to `1.0.0` / `1`.

## Secrets

All secrets are **optional** — the workflow degrades rather than fails when they're missing:

| Secret | Used by | If missing |
|--------|---------|-----------|
| `NOMAD_MAC_CERT` | macOS self-signed signing (below) | build is **ad-hoc** signed and can't auto-update (warning in the job log) |
| `NOMAD_MAC_CERT_PASSWORD` | macOS | — |
| `MAC_CERTS` | macOS (Apple Developer ID) | build is not Developer ID signed (`CSC_IDENTITY_AUTO_DISCOVERY=false`) |
| `MAC_CERTS_PASSWORD` | macOS | — |
| `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization | not notarized |
| `ANDROID_KEYSTORE` | Android | signed with the committed **debug** keystore (warning in the job log) |
| `ANDROID_KEYSTORE_PASSWORD` | Android | — |
| `ANDROID_KEY_ALIAS` | Android | — |
| `ANDROID_KEY_PASSWORD` | Android | — |

### Setting up the macOS self-signed certificate

The Mac app isn't signed with an Apple Developer ID. It's signed with a free self-signed
certificate instead, and that is what lets it auto-update. Squirrel.Mac (the Mac updater behind
electron-updater) only installs a new build whose code signature satisfies the running app's
designated requirement. An ad-hoc signature's requirement is that build's own hash, so an ad-hoc
build fails every update with *"code failed to satisfy specified code requirement(s)"*. Builds
signed with the same certificate share one requirement, so updates install. Gatekeeper still
warns on first launch, as it does for an unsigned app (right-click → Open).

Make the certificate once, on your Mac, with `gh` signed in:

```
sh scripts/make-mac-signing-cert.sh
```

It writes `~/.nomad-signing/nomad.p12` and its password, and sets the `NOMAD_MAC_CERT` and
`NOMAD_MAC_CERT_PASSWORD` secrets. The release workflow imports it into a temporary keychain,
trusts it for code signing, and `scripts/afterPackHook.js` signs with it
(`NOMAD_MAC_SIGN_IDENTITY`).

> **Back up `~/.nomad-signing`.** A build signed with a different certificate can't update an app
> signed with this one, so a lost certificate means everyone reinstalls by hand. Rerunning the
> script reuses the existing certificate. An app that was ad-hoc signed (1.17.0 and earlier) can't
> update to a self-signed build either: install the first self-signed release from its dmg.

### Setting up the Android release keystore

Generate a keystore once (modern `keytool` creates PKCS12, where the store and key passwords are
the same — pressing Enter at the "key password" prompt reuses the store password):

```bash
keytool -genkeypair -v -keystore nomad-release.keystore -alias nomad \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then set the four secrets. `ANDROID_KEYSTORE` is the **base64 of the keystore file** (pipe it —
don't paste it interactively); the other two password prompts take the passwords you gave
`keytool`. If your clone has multiple git remotes, `gh` requires `-R` to disambiguate:

```bash
base64 -i nomad-release.keystore | gh secret set ANDROID_KEYSTORE -R knownasilya/nomad
gh secret set ANDROID_KEYSTORE_PASSWORD -R knownasilya/nomad   # prompts: store password
gh secret set ANDROID_KEY_ALIAS -R knownasilya/nomad --body nomad
gh secret set ANDROID_KEY_PASSWORD -R knownasilya/nomad        # prompts: key password
gh secret list -R knownasilya/nomad                            # verify all four exist
```

> **Back up `nomad-release.keystore` somewhere safe and never commit it** (it is gitignored via
> `*.keystore`). Android app identity is permanently tied to the signing key: a lost keystore means
> users can't upgrade — they must uninstall and reinstall. Debug-signed builds (the fallback)
> likewise can't be upgraded in place to release-signed ones. GitHub secrets are write-only, so the
> Actions secret is **not** a recoverable backup — keep an independent copy.

## How the Android job builds

For reference (mirrors local dev, see [`mobile/README.md`](../mobile/README.md)):

1. `npm ci` in `mobile/`
2. `npm run bundle` — packs the Bare backend into `app/app.bundle.mjs` (`bare-pack`)
3. `npx expo prebuild --platform android --no-install` — `mobile/android/` is **not committed**
   (continuous native generation); prebuild regenerates it, and the config plugins in
   `mobile/plugins/` inject the Gradle-version pin and the release signing config
4. `./gradlew bundleRelease assembleRelease` with JDK 17 (the JS bundle itself is produced by
   Expo's `export:embed` inside the Gradle build)

Release signing lives in [`mobile/plugins/withReleaseSigning.js`](../mobile/plugins/withReleaseSigning.js):
the generated `build.gradle` reads `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` from the environment at build time and falls back
to the debug keystore when unset — so a plain local `npm run android` keeps working with no setup
(a release built that way installs, but can't be upgraded to a properly-signed build).
