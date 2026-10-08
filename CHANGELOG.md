# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.11.2](https://github.com/knownasilya/nomad/compare/v1.11.1...v1.11.2) (2026-10-08)


### Bug Fixes

* **spaces:** rebuild a lost drive list from local drive history ([f969ba7](https://github.com/knownasilya/nomad/commit/f969ba773a9eab1899e9ab91978903e9243882a6))

### [1.11.1](https://github.com/knownasilya/nomad/compare/v1.11.0...v1.11.1) (2026-10-08)


### Bug Fixes

* **spaces:** recover the drive list from an earlier root drive ([bea6130](https://github.com/knownasilya/nomad/commit/bea6130ce7f8fa0b2b490f7d934ce0bbb8f40294))

## [1.11.0](https://github.com/knownasilya/nomad/compare/v1.10.0...v1.11.0) (2026-10-08)


### Features

* **devices:** show sync status for the Vault and each space ([086d9f5](https://github.com/knownasilya/nomad/commit/086d9f5f9308f9d6d28d77dca95f550d0425f6f2))

## [1.10.0](https://github.com/knownasilya/nomad/compare/v1.9.0...v1.10.0) (2026-10-08)


### Features

* **ai:** list Claude models from the CLI with readable names ([0d3ed1b](https://github.com/knownasilya/nomad/commit/0d3ed1b23d12ddc7723d76dfb214ef690666918e))

## [1.9.0](https://github.com/knownasilya/nomad/compare/v1.8.1...v1.9.0) (2026-10-08)


### Features

* **discovery:** add opt-in drive listing, manifest crawler, and nomad://search ([fc74956](https://github.com/knownasilya/nomad/commit/fc7495618e3da2d41cec83d7bc9bc5dd5ae4818b))


### Bug Fixes

* **mobile:** keep bottom sheets above the Android navigation bar ([b0b0c96](https://github.com/knownasilya/nomad/commit/b0b0c969dbac88d768a8688752206081ce8bafc0))
* **spaces:** don't crash setup when moving the default space root ([c75e1a6](https://github.com/knownasilya/nomad/commit/c75e1a6ce4c6f796d6b18d562dd73ddad0e3d59b))

### [1.8.1](https://github.com/knownasilya/nomad/compare/v1.8.0...v1.8.1) (2026-10-08)


### Bug Fixes

* **ai:** send photos to Claude as inline image blocks ([700e5c2](https://github.com/knownasilya/nomad/commit/700e5c283fd5299131d8e33615d15aa4e53c76d0))
* **ai:** use the existing Claude CLI login ([9768a95](https://github.com/knownasilya/nomad/commit/9768a955d682a7b0cb71c1437e68593581068dc0))
* **spaces:** keep the shared Personal space on the live root drive ([bd3ca22](https://github.com/knownasilya/nomad/commit/bd3ca22fed0e13e5084c4a213f2e3e1a91aa9095))

## [1.8.0](https://github.com/knownasilya/nomad/compare/v1.7.0...v1.8.0) (2026-10-07)


### Features

* **ai:** allow plain completions with a token cap ([a28d804](https://github.com/knownasilya/nomad/commit/a28d804c565f92c6cb3a6bb966c355e2c78c7f8a))
* **ai:** multi-runtime support (Claude, Cursor, named OpenAI servers) ([da054c8](https://github.com/knownasilya/nomad/commit/da054c87b80f6f3610feb9b4ad4a8959bb223904))
* **ai:** offer the model search and execute ([93e886e](https://github.com/knownasilya/nomad/commit/93e886e32c2a18f21127714d5a1f756d4e3d83e3))
* **ai:** serve search and execute on loopback ([ca82b44](https://github.com/knownasilya/nomad/commit/ca82b44f76e4e12dbd790f54b04d1546b0a8f601))
* **navbar:** add Copy URL button with toast confirmation ([ce1abd9](https://github.com/knownasilya/nomad/commit/ce1abd972b3ee3446dca5f70cace3d5b93e7dfc9))


### Bug Fixes

* **ai:** accept the utility process message event ([e2ec3eb](https://github.com/knownasilya/nomad/commit/e2ec3ebc99f649a1a83f232021be4dce1846cb75))
* **ai:** send enable_thinking when reasoning is turned off ([fecc61f](https://github.com/knownasilya/nomad/commit/fecc61ffa97b77a250a1f9346774b79b6abad720))
* **drives:** keep folder and git sync on collaborative drives ([680f3dc](https://github.com/knownasilya/nomad/commit/680f3dc580fa7b7642fad0d184f91cac5e71dfad))
* **drives:** release the core when a Hyperdrive open fails ([fce0b0a](https://github.com/knownasilya/nomad/commit/fce0b0a93fc7c1a1bb0647adc9295a1463f66454))
* **mobile:** show a shared space's drives in My Library ([2d0997c](https://github.com/knownasilya/nomad/commit/2d0997c8f6cc6c8c26f66eae81f4d4d58702d9f2))

## [1.7.0](https://github.com/knownasilya/nomad/compare/v1.6.0...v1.7.0) (2026-09-12)


### Features

* **ai:** keep the Provider device awake while it shares its AI runtime ([555538c](https://github.com/knownasilya/nomad/commit/555538cb4229eb5577c5825e0cca8c9f31e9c1a2))


### Bug Fixes

* **ai:** register getAiKeepAwakeStatus on the browser WEBAPI object ([0fd24ae](https://github.com/knownasilya/nomad/commit/0fd24aedca5633529d3d3c068f2c0d64ebbb6484))
* **mobile:** keep the AI panel's composer above the Android navigation bar ([ef47afc](https://github.com/knownasilya/nomad/commit/ef47afcdcf57f60f4a9e9c98301c7077b0629054))

## [1.6.0](https://github.com/knownasilya/nomad/compare/v1.5.1...v1.6.0) (2026-09-12)


### Features

* **ai:** move the AI Sidebar into the shell and add WebMCP page tools ([2c8c9c9](https://github.com/knownasilya/nomad/commit/2c8c9c9db127def9559ef564efc0112ffe033742))


### Bug Fixes

* **fs:** gate cross-drive writes and writer-management on Autobase drives ([b8f30cd](https://github.com/knownasilya/nomad/commit/b8f30cd682711effbf3a76faefe8ff2e3947bf4b))
* **fs:** self-heal typeless autobase registry entries from the serve path ([d6c94a4](https://github.com/knownasilya/nomad/commit/d6c94a40180169be70a0edbc477b98a609457807))
* **mobile:** keep the AI panel above the keyboard and alive in the background ([af72f55](https://github.com/knownasilya/nomad/commit/af72f552e22e90aef4a864f0253dd9919feb34c8))
* **shell-window:** clear window controls in the sidebar layout and hide them in fullscreen ([9dd5114](https://github.com/knownasilya/nomad/commit/9dd5114f6b477bd33119ac034a3bc57c2b93f13d))
* **shell-window:** Linux window controls on the left, macOS-style ([2a77a6e](https://github.com/knownasilya/nomad/commit/2a77a6e6e604306e8320340720b167c6874f3f1f))

### [1.5.1](https://github.com/knownasilya/nomad/compare/v1.5.0...v1.5.1) (2026-07-11)


### Bug Fixes

* **fs:** recover from wrong-backend DECODING_ERROR and register autobase drives with their type ([a2984b5](https://github.com/knownasilya/nomad/commit/a2984b583c36a1ef5e3e18f0018cfd5518e721e9))
* **shell-window:** window controls on Linux and Windows ([1dd9899](https://github.com/knownasilya/nomad/commit/1dd98995d648360e0708b4338d3c87408fc5d601))

## [1.5.0](https://github.com/knownasilya/nomad/compare/v1.4.0...v1.5.0) (2026-07-11)


### Features

* **hosting:** mirror hosted drives on desktop + daily hosting data budget on mobile ([caa70e1](https://github.com/knownasilya/nomad/commit/caa70e12fb6698efc9057773d7f416457a141817))

## [1.4.0](https://github.com/knownasilya/nomad/compare/v1.3.1...v1.4.0) (2026-07-11)

### [1.3.1](https://github.com/knownasilya/nomad/compare/v1.3.0...v1.3.1) (2026-07-11)


### Bug Fixes

* **mobile:** normalize loopback-gateway URLs to hyper:// in the nomad bridge ([004eeb5](https://github.com/knownasilya/nomad/commit/004eeb51ba50b0341aa02cb377470ed2a12dec8d))

## [1.3.0](https://github.com/knownasilya/nomad/compare/v1.2.32...v1.3.0) (2026-07-10)


### Features

* **api:** nomad.page + nomad.parseUrl — host-provided page identity ([5723012](https://github.com/knownasilya/nomad/commit/5723012ba316892d4d47ac867e13ad9d471104db))
* **mobile:** loopback HTTP gateway — serve drives from a real origin ([2ae7e65](https://github.com/knownasilya/nomad/commit/2ae7e65bcd6b46782aefe278af10df4c10d5ad23))


### Bug Fixes

* **reader:** align unread dot and feed counts ([414bb5b](https://github.com/knownasilya/nomad/commit/414bb5b4004708b24991abf753cab7555c52097f))
* **vault:** publish local Spaces to the Vault so paired devices see them ([43190fd](https://github.com/knownasilya/nomad/commit/43190fd083f017a059e509bde3c0f8fda293d1d6))

### [1.2.32](https://github.com/knownasilya/nomad/compare/v1.2.31...v1.2.32) (2026-07-10)


### Bug Fixes

* **drafts:** clear preview flag when a Draft is emptied by discard/publish ([8aa778e](https://github.com/knownasilya/nomad/commit/8aa778e75b7431f0b6b1bea39b4f0f0632b32884))
* **session:** always preserve tabs across soft and hard close ([faa0da1](https://github.com/knownasilya/nomad/commit/faa0da1b217c604863edd6fcd1fe3a805d2f883e))

### [1.2.31](https://github.com/knownasilya/nomad/compare/v1.2.30...v1.2.31) (2026-07-10)


### Bug Fixes

* **mobile:** Android back button navigates back instead of exiting ([8a6e5fc](https://github.com/knownasilya/nomad/commit/8a6e5fc0a2f4382a985e81af7f141b958cc9e978))
* **mobile:** lift AI panel input above the Android keyboard ([72c3397](https://github.com/knownasilya/nomad/commit/72c33975a4bfbee778bf41430ddf0c9032b5620a))
* **mobile:** show drive name + URL in the AI Bridge edit-consent prompt ([d02856a](https://github.com/knownasilya/nomad/commit/d02856a3a5cb9dec6739ad2a24a8564440822753))

### [1.2.29](https://github.com/knownasilya/nomad/compare/v1.2.28...v1.2.29) (2026-07-10)

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
