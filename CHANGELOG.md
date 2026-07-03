# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## Unreleased

### Features

* **Devices / multi-device:** link multiple devices to one identity so they all read and edit your Spaces and Drives. Adds the **Vault** (an identity-level Collaborative Drive indexing your Spaces and Devices), device pairing via `blind-pairing` (invite code + explicit approval), and a **Settings → Devices** subpage. Profile Drives stay multi-writer by `writer-keys` aggregation (URL preserved). See `docs/multi-device-protocol.md`, ADR-0006, ADR-0007. Mirrored in Nomad mobile.
* **Blog + Reader:** a multi-device, URL-addressable blog format and an in-browser RSS-like reader. Adds the `walled.garden/feed` channel schema (and `summary`/`tags`/`draft` plus optional `body` on `walled.garden/post`), a **Blog** drive template (an Autobase Collaborative Drive so every Device is a writer of one stable URL; posts are directory-per-post at `/posts/<YYYY-MM-DD-slug>/`), and **`nomad://reader`** (subscribe to feeds via `walled.garden/follows`, aggregate posts across Hyperdrive *and* Autobase feeds, synced read-state). Visiting a feed shows a **Subscribe in Reader** action. See ADR-0008, ADR-0009.

### [1.2.4](https://github.com/knownasilya/nomad/compare/v1.2.3...v1.2.4) (2022-03-25)


### Bug Fixes

* auto updater error not showing correctly in settings ([9e9dc60](https://github.com/knownasilya/nomad/commit/9e9dc600ccc38795feda917fe0e9ef069299b45d))

### [1.2.3](https://github.com/knownasilya/nomad/compare/v1.2.2...v1.2.3) (2022-03-25)


### Bug Fixes

* update auto-update version and settings ([b0b7c92](https://github.com/knownasilya/nomad/commit/b0b7c9211646d384d6b9d80bdcd1b470f20cbe26))

### [1.2.2](https://github.com/knownasilya/nomad/compare/v1.2.1...v1.2.2) (2022-03-25)


### Bug Fixes

* update intro to nomad ([e989347](https://github.com/knownasilya/nomad/commit/e9893470b0ccd9c4faead4b483def1a7f0987755))
* update intro with new logos ([6ed983c](https://github.com/knownasilya/nomad/commit/6ed983c9ec2e2e38437264cc6fc7e99bb84946ed))
* workaround for pdfs not loading over hyper://, also solve stopwatch undefined when opening those pdfs ([5b2c359](https://github.com/knownasilya/nomad/commit/5b2c3596866c6638fbb806e19e0e6245330e4511))

### [1.2.1](https://github.com/knownasilya/nomad/compare/v1.2.0...v1.2.1) (2022-03-12)


### Bug Fixes

* autoupdate repo and names ([fb75e46](https://github.com/knownasilya/nomad/commit/fb75e4679f5d448bc1cd492bf8630c895ca031b3))
* postbuild command, should resolve autoupdate? ([d8776d1](https://github.com/knownasilya/nomad/commit/d8776d190f7647206d8eca7e9708b2b4d69f5b54))

## [1.2.0](https://github.com/knownasilya/nomad/compare/v1.1.0...v1.2.0) (2022-03-12)


### Features

* add launch at startup ([37d815c](https://github.com/knownasilya/nomad/commit/37d815caf79e99e886e2153174d757271eab2803))
