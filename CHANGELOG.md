# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.27.0](https://github.com/knownasilya/nomad/compare/v1.26.3...v1.27.0) (2026-10-31)


### Features

* **ai:** let the AI Sidebar click, type and scroll on the page ([12c3dfe](https://github.com/knownasilya/nomad/commit/12c3dfef226014a75ec4a03c467315a6513028be))
* **ai:** steer the AI sidebar and the phone's AI panel while they work ([6be106e](https://github.com/knownasilya/nomad/commit/6be106e8d6efa52123e8c41a08ed1eac3184c572))
* **history:** select rows with checkboxes and delete them together ([6cd021d](https://github.com/knownasilya/nomad/commit/6cd021dbebe2c5c9f6ac04f87b147fb4ea8bc8bb))
* **updates:** update and restart a computer from the phone ([f6a56b4](https://github.com/knownasilya/nomad/commit/f6a56b47318f6bd21e5380d51aa20dbf62d69bb3))

### [1.26.3](https://github.com/knownasilya/nomad/compare/v1.26.2...v1.26.3) (2026-10-31)


### Bug Fixes

* **create-drive:** keep the template cards inside the modal ([5e46a17](https://github.com/knownasilya/nomad/commit/5e46a17c1f3f1e393a28bae93d120ce59a47cb05))
* **notes:** keep task lines as a checkbox while editing ([e3f65f7](https://github.com/knownasilya/nomad/commit/e3f65f7267c85de5c72c465e689544da1262f7c3))

### [1.26.2](https://github.com/knownasilya/nomad/compare/v1.26.1...v1.26.2) (2026-10-31)


### Bug Fixes

* **ai-sidebar:** load Leaflet when a map first draws, so the window isn't blank ([eebf10e](https://github.com/knownasilya/nomad/commit/eebf10eb93d1796b0bf91607c718d07958ab1ade))
* **settings:** drop the sidebar width slider ([8bcf5ff](https://github.com/knownasilya/nomad/commit/8bcf5ff611729bed1f6158bf0ef98a9b957542e4))

### [1.26.1](https://github.com/knownasilya/nomad/compare/v1.25.0...v1.26.1) (2026-10-30)


### Features

* **ai-sidebar:** cards for a purpose in generated UI ([91565a7](https://github.com/knownasilya/nomad/commit/91565a7b48a4da0b05b9c22a5c8201a0d5bd382c))
* **ai-sidebar:** draw charts, maps and other UI the assistant writes in OpenUI Lang ([fef61ed](https://github.com/knownasilya/nomad/commit/fef61ed15be07ffdebef0a29dd539f9612d5204e))
* **ai:** AI Jobs that run a prompt on a schedule and notify the phone ([fc79413](https://github.com/knownasilya/nomad/commit/fc794133a7ace02aae8ae430765954ed1d5e761e))
* **ai:** give tool events ids and an end, and send reasoning over the AI Bridge ([8289509](https://github.com/knownasilya/nomad/commit/8289509d884f74c93bb5484bf47c6254b1269bad))
* **ai:** more flexible AI Job schedules ([5550ca2](https://github.com/knownasilya/nomad/commit/5550ca2f48cf35fa51431313343c30452f06f592))
* **ai:** run an AI Job from a drive's job.md prompt and job.js module ([b43810a](https://github.com/knownasilya/nomad/commit/b43810a068c3800dc5d2f5d5742a45907bb2ecb8))
* **drives:** desktop per-drive writer keys and Writer grants (ADR-0029 step 2) ([97c2f30](https://github.com/knownasilya/nomad/commit/97c2f30d2a6adebf6d50f2026e70e961a6f90aad))
* **mobile:** Space-only Notes and Names on the phone (ADR-0029) ([11b233a](https://github.com/knownasilya/nomad/commit/11b233a23b16226783b01e74afba811248038bb5))
* share a Space with other people (ADR-0029 steps 3 to 7) ([20b7168](https://github.com/knownasilya/nomad/commit/20b716806d180d0fd2f43821377a0230cdfec5e3))
* **spaces:** Notes and Names that belong to one Space ([9466c7f](https://github.com/knownasilya/nomad/commit/9466c7f579b1ce2141c1943336d2b937fad708b8))


### Bug Fixes

* **editor:** escape the backticks in the nomad.ai onToolEvent comment ([cbb16c3](https://github.com/knownasilya/nomad/commit/cbb16c320037acecc5d14a19c1a0ac10e469f7e3))

## [1.26.0](https://github.com/knownasilya/nomad/compare/v1.25.0...v1.26.0) (2026-10-30)

Not released: the desktop build failed. Its changes ship in 1.26.1.

## [1.25.0](https://github.com/knownasilya/nomad/compare/v1.24.0...v1.25.0) (2026-10-30)


### Features

* **ai-sidebar:** polish the desktop AI sidebar's design ([66abfda](https://github.com/knownasilya/nomad/commit/66abfda0279f99e221cf61c6f6d8a8efcb7c2183))
* **ai:** copy a prompt or an answer in the AI panel and sidebar ([b619149](https://github.com/knownasilya/nomad/commit/b619149dbd6e5fe8bd29ad706824fd5ea61850af))


### Bug Fixes

* **ai-sidebar:** tighten the space the Copy row takes under each message ([e854d50](https://github.com/knownasilya/nomad/commit/e854d5097c2a7ae06967f1d8f8bab408b1bd5880))
* **ai:** the AI reads back its own Draft edits and asks once per drive ([a713308](https://github.com/knownasilya/nomad/commit/a7133086416b67b1758c236aa47227322b8a6a5f))

## [1.24.0](https://github.com/knownasilya/nomad/compare/v1.23.0...v1.24.0) (2026-10-30)


### Features

* **mobile:** stacked navigation, so back returns where you came from ([65f26fc](https://github.com/knownasilya/nomad/commit/65f26fc7ca72668e40f4b31072b06ea346c6cefe))

## [1.23.0](https://github.com/knownasilya/nomad/compare/v1.22.0...v1.23.0) (2026-10-30)


### Features

* **drives:** built-in drive templates and a live Document drive ([fd488a5](https://github.com/knownasilya/nomad/commit/fd488a5331f09054be348d7c6d40b4657fc6d5e0))
* **mobile:** show Reader and Notes changes from other devices while open ([0606bb5](https://github.com/knownasilya/nomad/commit/0606bb5a97985be924134798217de5587dc8dd2d))
* **spaces:** refresh the phone's spaces when the Vault changes ([568ac1d](https://github.com/knownasilya/nomad/commit/568ac1d1e8113dcf35d7d07ecba12e215130b63b))
* **spaces:** share one set of spaces between the phone and desktop ([42d679a](https://github.com/knownasilya/nomad/commit/42d679aa933682f8dd03f89bfbdeeec26a2e4564))
* **tabs:** load restored tabs at startup without a spinner on each ([aa773e8](https://github.com/knownasilya/nomad/commit/aa773e8ca677686785a8856dae2b45762adb22ee))

## [1.22.0](https://github.com/knownasilya/nomad/compare/v1.21.0...v1.22.0) (2026-10-30)


### Features

* **mobile:** make the Android app feel native, and match desktop's dark mode ([ba689e8](https://github.com/knownasilya/nomad/commit/ba689e841412be2047d78674740885e9cc23dd1c))
* **mobile:** the Android app updates itself from GitHub Releases ([4a5038c](https://github.com/knownasilya/nomad/commit/4a5038c8b2690c9445038a7d0ed1b7decbbb753e))
* **mobile:** use your names on the phone ([a47c70c](https://github.com/knownasilya/nomad/commit/a47c70c0581c0aece6cdd4633b40d92aa0952ff6))
* **notes:** add a canvas view of notes and their links ([0e254c1](https://github.com/knownasilya/nomad/commit/0e254c1fa687d6f5ec6396720159f8ff7178b86d))
* opt into beta releases on desktop and mobile ([e418705](https://github.com/knownasilya/nomad/commit/e418705cf5cfca8271b04581873321dc2e20bc61))
* show each device's Nomad version in Devices and flag a mismatch ([5c0c8c5](https://github.com/knownasilya/nomad/commit/5c0c8c52a64629c09e111e9e64875b68ff7e99fb))
* **tabs:** see the tabs open on your other devices, by space ([d7ef707](https://github.com/knownasilya/nomad/commit/d7ef707b115bf364cdda246568806bf69f09ece5))

## [1.21.0](https://github.com/knownasilya/nomad/compare/v1.20.0...v1.21.0) (2026-10-29)


### Features

* **devices:** show a drive's last error in the phone's Sync details ([708842a](https://github.com/knownasilya/nomad/commit/708842a50c413814c79f25df5dd27d0b6e4ba671))
* **mobile:** a Settings screen and a Logs page like desktop's ([9a98d46](https://github.com/knownasilya/nomad/commit/9a98d462487e2c832ab29d0ecf08d1f8c0202bf4))
* **mods:** new Mod and a Mods on/off submenu in the tab context menu ([f47490d](https://github.com/knownasilya/nomad/commit/f47490d337c4a22e11b8b750a163e9ed8ef8e7ce))
* **navbar:** move Mods into the site menu, hide its empty arrow, move AI button ([4ad39cc](https://github.com/knownasilya/nomad/commit/4ad39cc3e6a982f2539d8c39d128aeb5a7680633))


### Bug Fixes

* **spaces:** don't crash the phone when a synced space's drive fails ([1d64f98](https://github.com/knownasilya/nomad/commit/1d64f9872bf0fd08d201576ab7e84230ac86d10e)), closes [#57](https://github.com/knownasilya/nomad/issues/57)

## [1.20.0](https://github.com/knownasilya/nomad/compare/v1.19.0...v1.20.0) (2026-10-29)


### Features

* **names:** mark names with a tag icon instead of @ ([6ab6753](https://github.com/knownasilya/nomad/commit/6ab6753b968be5de18553ab46c5526f78f0704a5))
* **names:** show the user's own name as [@name](https://github.com/name) in the location bar ([a1e7978](https://github.com/knownasilya/nomad/commit/a1e7978b68dfa7bb9cf8835a490dead406109d02))
* **search:** named search sources, a subtle "found by" line, and a page that looks like the browser ([1d194aa](https://github.com/knownasilya/nomad/commit/1d194aa5f01307a6f5091557162647687a16f1e2))


### Bug Fixes

* **names:** put the green check on the @ of the location bar's [@name](https://github.com/name) ([b4b6ef4](https://github.com/knownasilya/nomad/commit/b4b6ef48c6ebf319401b9203b1d22556de06b1c9))
* **search:** Search Nomad from the URL bar opens nomad://search with the query ([757b65c](https://github.com/knownasilya/nomad/commit/757b65c00632fcea11382cac91576ca704ba6690))
* **sidebar:** show tabs and groups in tab order, so a new tab lands below the groups ([a0b5431](https://github.com/knownasilya/nomad/commit/a0b5431e8cff3e1b2fdfde39f08bd22e4364da82))

## [1.19.0](https://github.com/knownasilya/nomad/compare/v1.18.1...v1.19.0) (2026-10-29)


### Features

* **boosts:** Arc-style per-site Boosts with zapper, tab toggles and AI tools ([19f2ad1](https://github.com/knownasilya/nomad/commit/19f2ad12f8a6f4310a20104cf3677efc1476fe15))
* **devices:** show each device's spaces and whether it's connected ([610e5b9](https://github.com/knownasilya/nomad/commit/610e5b93a9f84ae497fa06aec89b562ccf2672c3))


### Bug Fixes

* **search:** serve the crawler on a free port when 8787 is taken ([8136d85](https://github.com/knownasilya/nomad/commit/8136d85b3803652b2abf73dcad434207b0b67706))
* **spaces:** publish a new Space to the Vault so paired Devices see it ([4942850](https://github.com/knownasilya/nomad/commit/494285014f86b15482ad623d2d4e9f6219c3e61d))

### [1.18.1](https://github.com/knownasilya/nomad/compare/v1.18.0...v1.18.1) (2026-10-28)


### Bug Fixes

* **spaces:** route cmd-clicked links, and reorder rules by drag ([10cde92](https://github.com/knownasilya/nomad/commit/10cde92459ed7fcb521aaa31026ea787830f24a3))

## [1.18.0](https://github.com/knownasilya/nomad/compare/v1.17.1...v1.18.0) (2026-10-28)


### Features

* **names:** the AI names sites you visit often ([a6eaeba](https://github.com/knownasilya/nomad/commit/a6eaeba4b51fb285f76df570840a63d8060267af))
* **spaces:** add URL routing rules (Air Traffic Control) ([febdb79](https://github.com/knownasilya/nomad/commit/febdb7909ede0a29f155555ade2886b63d0a3294))

### [1.17.1](https://github.com/knownasilya/nomad/compare/v1.17.0...v1.17.1) (2026-10-25)


### Bug Fixes

* **release:** sign the Mac app with a self-signed certificate so updates install ([6d5421f](https://github.com/knownasilya/nomad/commit/6d5421f4003190b50748c81ee0e388e7346b828f))

## [1.17.0](https://github.com/knownasilya/nomad/compare/v1.16.0...v1.17.0) (2026-10-24)


### Features

* **ai:** let the user's own AI open a new tab ([39369ff](https://github.com/knownasilya/nomad/commit/39369ff2179371e805b31a19b3256d97c005bdda))
* **tabs:** drag tabs into sidebar groups, group menu, AI opens tabs in a group ([68098ed](https://github.com/knownasilya/nomad/commit/68098edd70cac09e80d70054dcbbb8aeff33aa98))


### Bug Fixes

* **capabilities:** record the page's real origin as the owner ([076a767](https://github.com/knownasilya/nomad/commit/076a7671f6a498bebb37352a13be26904b435c0f))
* **fs:** deliver nomad.fs.watch events to pages ([4fbbe57](https://github.com/knownasilya/nomad/commit/4fbbe570e7c748701bb564629951553c30d75d8b))
* **fs:** keep pages out of the private drive ([6c88302](https://github.com/knownasilya/nomad/commit/6c88302e6827f8145c31c0844828896aaf2d3a52))

## [1.16.0](https://github.com/knownasilya/nomad/compare/v1.15.0...v1.16.0) (2026-10-12)


### Features

* **ai:** let the user's own AI highlight text, with or without a Note ([7e5d935](https://github.com/knownasilya/nomad/commit/7e5d935e9984c7c661bb2af22416f8b4f9d1536c))
* **highlights:** View > Hide Highlights ([f5e6df5](https://github.com/knownasilya/nomad/commit/f5e6df5f07dbd459750352a5e81913262220eb0f))
* **notes:** collapse linked mentions, and scroll a long list ([773563d](https://github.com/knownasilya/nomad/commit/773563d0a3bc77973968362f2e97abbf4cdb993b))

## [1.15.0](https://github.com/knownasilya/nomad/compare/v1.14.0...v1.15.0) (2026-10-12)


### Features

* **ai:** keep the AI sidebar open across tabs ([0041f5e](https://github.com/knownasilya/nomad/commit/0041f5ed8a32d81f77da2fdf4d8fb8e8b5e4bcfe))
* **ai:** run a CLI turn's tools in that turn's context, and say each step in plain words ([079682d](https://github.com/knownasilya/nomad/commit/079682d1ad8387a271e9d68b462eb4f38e3c1e9b))
* **ai:** the assistant is not tied to a tab ([493d942](https://github.com/knownasilya/nomad/commit/493d9420354edd4dce1be3e56f910a63f1a843be))
* **highlights:** highlight text on a page and leave a note about it ([2bc1c14](https://github.com/knownasilya/nomad/commit/2bc1c1412c6ed1bed6115651e2e87c816dcf620f))


### Bug Fixes

* **ai:** show a Claude or Cursor CLI reply once, not three times ([e97a2c4](https://github.com/knownasilya/nomad/commit/e97a2c41f1454cd7b977db3b83668bb49e64aa20))

## [1.14.0](https://github.com/knownasilya/nomad/compare/v1.13.0...v1.14.0) (2026-10-11)


### Features

* **ai:** the user's own AI can use their Notes and Reader ([d417fd0](https://github.com/knownasilya/nomad/commit/d417fd0888bfee5629a56922204e971ef4e1985d))
* **names:** short names for drives, apps and pages, in the URL bar and for the AI ([d181c36](https://github.com/knownasilya/nomad/commit/d181c36d23aa1b30bde5be1cd72c087619699c60))


### Bug Fixes

* **names:** refuse dots, and names Chromium reads as numbers ([6ea4b81](https://github.com/knownasilya/nomad/commit/6ea4b8131da3153a7a0e162f9dadfa5b11b9b725))
* **notes:** the editor fills its pane ([380fff1](https://github.com/knownasilya/nomad/commit/380fff1815d707253ed2d7d35634e23a660ed31f))

## [1.13.0](https://github.com/knownasilya/nomad/compare/v1.12.0...v1.13.0) (2026-10-10)


### Features

* **mobile:** Reader and Notes on the phone ([bbaa0bf](https://github.com/knownasilya/nomad/commit/bbaa0bf77cc6356ce9a0d332d6ddc879beafdd7a))
* **notes:** Markdown notes with Obsidian-style Live Preview and [[links]] ([40cbb40](https://github.com/knownasilya/nomad/commit/40cbb40d05e0cce64641d77eb729696bb6efca61))
* **reader:** dark mode, styled like Search ([8fb1bd3](https://github.com/knownasilya/nomad/commit/8fb1bd305babeecb0675995a3b10da6b040ee993))
* **vault:** Reader subscriptions and Notes live in the Vault (ADR-0017) ([abaa049](https://github.com/knownasilya/nomad/commit/abaa04916d6096344c9440749fb5cec7180002ab))


### Bug Fixes

* **autobases:** a Device that joins a Drive turns writable without a restart ([94053f8](https://github.com/knownasilya/nomad/commit/94053f876e460bc33a64438cde682c402418cde7))
* **shell:** dark scrollbars in the Tab Sidebar ([3df32a9](https://github.com/knownasilya/nomad/commit/3df32a92c699318512f748eac18390b9bda4cfa4))

## [1.12.0](https://github.com/knownasilya/nomad/compare/v1.11.2...v1.12.0) (2026-10-09)


### Features

* **ai:** the AI's search tool finds drives listed for public search ([31562a6](https://github.com/knownasilya/nomad/commit/31562a6d296bd7a7d97db36abf89f46a5ad27e1a))
* **library:** the Listings toggle lists or unlists right away ([0f909dc](https://github.com/knownasilya/nomad/commit/0f909dce28d5fdd251e903e0f53de03c02376878))
* **mobile:** Chrome-style tab grid and pinned home shortcuts ([be4f2a5](https://github.com/knownasilya/nomad/commit/be4f2a51af1447ccf82c5232ecf11f0d640ec5ec))
* **mobile:** photos in the AI panel, plain-text replies, nomad.ai in drive apps ([e377151](https://github.com/knownasilya/nomad/commit/e37715112a2f2141efb063bedd76324cecda0952))
* **search:** redesign nomad://search to match My Library ([67bcd42](https://github.com/knownasilya/nomad/commit/67bcd4241f6db33be2f06b65054abb2e7d994d77))
* **search:** run the search crawler in the browser, synced across devices ([54dcc47](https://github.com/knownasilya/nomad/commit/54dcc4781079f45fdb6a507666cee457809765c5))


### Bug Fixes

* **desktop:** readable Create shortcut dialog and Listings page in dark mode ([0ec146f](https://github.com/knownasilya/nomad/commit/0ec146f12a37e1a3e64cf510f9ebd371ca8f8986))
* **tabs:** reopen on the tab that was active when the window closed ([da21419](https://github.com/knownasilya/nomad/commit/da21419e06f8b649f1e111512220b33c50f1e2fb))

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
