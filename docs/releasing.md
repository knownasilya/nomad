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

> **Mobile note:** the Android `versionName`/`versionCode` come from the **tag** in CI (see
> [Versioning (Android)](#versioning-android)), so `mobile/app.json`'s `version` is only a local-dev
> fallback and is *not* bumped by `standard-version` — nudge it by hand if you care about the
> local-build version.

## What a tag triggers

Pushing a tag matching `v*` (e.g. `v1.2.3`) triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which runs three build jobs:

| Job | Runner | Output | Uploaded as |
|-----|--------|--------|-------------|
| Build macOS | `macos-latest` | Electron app (signed + notarized if secrets set) | electron-builder artifacts |
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

## Versioning (Android)

The Android job derives versions from the tag:

- `versionName` = the tag without the `v` prefix (`v1.2.3` → `1.2.3`)
- `versionCode` = `major×1000000 + minor×1000 + patch` (`v1.2.3` → `1002003`)

Both are passed to Gradle as environment variables (`NOMAD_VERSION_NAME` / `NOMAD_VERSION_CODE`);
local builds without them fall back to `1.0.0` / `1`.

## Secrets

All secrets are **optional** — the workflow degrades rather than fails when they're missing:

| Secret | Used by | If missing |
|--------|---------|-----------|
| `MAC_CERTS` | macOS | build is unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`) |
| `MAC_CERTS_PASSWORD` | macOS | — |
| `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization | not notarized |
| `ANDROID_KEYSTORE` | Android | signed with the committed **debug** keystore (warning in the job log) |
| `ANDROID_KEYSTORE_PASSWORD` | Android | — |
| `ANDROID_KEY_ALIAS` | Android | — |
| `ANDROID_KEY_PASSWORD` | Android | — |

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
