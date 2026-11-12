# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.50.3](https://github.com/knownasilya/nomad/compare/v1.50.2...v1.50.3) (2026-11-12)


### Bug Fixes

* **mobile:** draw a PDF in Assets only once the viewer has a width ([74849b8](https://github.com/knownasilya/nomad/commit/74849b8dc02dad1fb06dcf497142e92c16d5dda0))

### [1.50.2](https://github.com/knownasilya/nomad/compare/v1.50.1...v1.50.2) (2026-11-12)


### Bug Fixes

* **mobile:** open a PDF in Assets even when the WebView can't start pdf.js's worker ([e7a7930](https://github.com/knownasilya/nomad/commit/e7a79303cafcfbef593c1f66ed6859af2e6cd5ca))

### [1.50.1](https://github.com/knownasilya/nomad/compare/v1.50.0...v1.50.1) (2026-11-12)


### Bug Fixes

* **mobile:** a PDF or book that won't open in Assets says so, and logs why ([ef6e3db](https://github.com/knownasilya/nomad/commit/ef6e3db74799ebacdd1a8631c4c6833922dcfdc0))

## [1.50.0](https://github.com/knownasilya/nomad/compare/v1.49.0...v1.50.0) (2026-11-12)


### Features

* **ai:** a Job can keep a card on the home page ([008349b](https://github.com/knownasilya/nomad/commit/008349b1236bcfa57f4f256fc2d533402dd648be))
* **ai:** more GenUI components, and a home page the AI can draw ([e14864d](https://github.com/knownasilya/nomad/commit/e14864dfc1cc9aea912d3584f4eb5df09c0525f7))
* **ai:** the MCP's search index names the home page and its guides ([2e10b61](https://github.com/knownasilya/nomad/commit/2e10b61c8f584cccfa03e4550dd5080147c790b3))
* **home:** each Space gets its own home page, and a shared one is everyone's ([496d0d9](https://github.com/knownasilya/nomad/commit/496d0d91b6de833017fcdc8d2abb13cdbaf6591c))
* **home:** live cards that read the calendar, Jobs, Notes and drives ([dd2ea3c](https://github.com/knownasilya/nomad/commit/dd2ea3c3f89cc5c445eb39fcce3b7b78281c24c5))


### Bug Fixes

* **ui:** dark scrollbars on nomad:// pages in dark mode ([cd9c869](https://github.com/knownasilya/nomad/commit/cd9c869d894962ef1d269835cb5f4470d454afeb))

## [1.49.0](https://github.com/knownasilya/nomad/compare/v1.48.1...v1.49.0) (2026-11-11)


### Features

* **assets:** sandboxed HTML previews, Preview / Source, and pages the AI draws ([20e9df9](https://github.com/knownasilya/nomad/commit/20e9df99569a90149b97c2c7abfa79b6df481b71))


### Bug Fixes

* **mobile:** a picture in a folder fills the Assets viewer like one at the top ([ccbc9e3](https://github.com/knownasilya/nomad/commit/ccbc9e3905e12cd76e4b5d20969d950126b439ff))
* **personas:** check a Profile Drive again when it opens after the time limit ([d2e562e](https://github.com/knownasilya/nomad/commit/d2e562e5415ac8edae876f6b58f03fe2c490e719))

### [1.48.1](https://github.com/knownasilya/nomad/compare/v1.48.0...v1.48.1) (2026-11-10)


### Bug Fixes

* **assets:** PDFs keep drawing after the viewer redraws around them ([38bf746](https://github.com/knownasilya/nomad/commit/38bf746684f7f3ddb2ee03a0978b5dbde6a74404))

## [1.48.0](https://github.com/knownasilya/nomad/compare/v1.47.0...v1.48.0) (2026-11-10)


### Features

* **ai:** Notes, Assets and drives link back to the AI chat that made them (ADR-0047) ([096fdae](https://github.com/knownasilya/nomad/commit/096fdae9a8ce79f0c22b16c15146917057383fda))
* **home:** dismiss a notification or clear them all ([a62268d](https://github.com/knownasilya/nomad/commit/a62268d866e56c0488a4d58f287d709e43ad7883))
* **jobs:** a time limit per Job, lifted while someone watches the run ([2c38389](https://github.com/knownasilya/nomad/commit/2c383897a0b56daca59ce431232f83e3f948a2c5))
* **mobile:** past chats in the phone's AI panel, and a roomier panel ([a6403c7](https://github.com/knownasilya/nomad/commit/a6403c71c0c95c13fead18e0f4d85606fd01cf97))
* **notes:** fold the AI chat lines into one quiet "Made with AI" line ([74cbbf7](https://github.com/knownasilya/nomad/commit/74cbbf71442eeb8785a28797b014d820c2378c74))
* **notes:** the AI chats sit under Linked mentions on desktop, a chip in the topics bar on the phone ([ac09bb1](https://github.com/knownasilya/nomad/commit/ac09bb1f542c461328a32305a79264da1ac236fd))
* **notifications:** show a notification only on the Device the user is using ([4ad9f6b](https://github.com/knownasilya/nomad/commit/4ad9f6b13f902bb67844dd20b0b0aac3c4357ed8))
* **private-drive:** let the user pick how long a page keeps a path ([369f05b](https://github.com/knownasilya/nomad/commit/369f05b5d4bc2704928e52018f5844618aef9794))


### Bug Fixes

* **ai:** say "Updated" when the AI only changed an item, and name the folded list "AI chats" ([329bcf4](https://github.com/knownasilya/nomad/commit/329bcf4ae54ceb87ecd02e5b7f5c55ec74ff6d6b))
* **assets:** videos and PDFs open on the phone again ([b04ddde](https://github.com/knownasilya/nomad/commit/b04dddedec0b2a3278d06851e204288969b0adfc))
* **notes:** name the folded AI list "Linked AI chats", like Linked mentions ([be86808](https://github.com/knownasilya/nomad/commit/be86808b03521d404c378eb109d461fa3360a56b))
* **site-info:** AI chat links stand out from plain lines in dark mode ([74c6a49](https://github.com/knownasilya/nomad/commit/74c6a49a5f2ab9388de5890f1846541b19f07e19))

## [1.47.0](https://github.com/knownasilya/nomad/compare/v1.46.0...v1.47.0) (2026-11-09)


### Features

* **ai:** phone AI prompts can last longer than one answer, as on desktop ([f8606f7](https://github.com/knownasilya/nomad/commit/f8606f711e2431bd3d631bac0e0fa391d97c1395))
* **assets:** 500 MB files, movies, PDFs and e-books, and pinch zoom on the phone ([00d3426](https://github.com/knownasilya/nomad/commit/00d34268db7bf91d31efe29cf6694506771ee748))
* **assets:** folders, tags, changes to many, and links from Notes ([36b8778](https://github.com/knownasilya/nomad/commit/36b8778c1a58d977156af72db0a51a18d52d1632))
* **home:** a Needs you section for what waits on the user's answer ([46a7ca7](https://github.com/knownasilya/nomad/commit/46a7ca7609b04ac80e2f7e0e726bc0822fc3b980))
* **home:** turn the home page into a dashboard on desktop and phone ([9972685](https://github.com/knownasilya/nomad/commit/9972685a3972ab14c569513e0c55156fd7b376cc))
* **mobile:** Android home screen search widget ([946dfab](https://github.com/knownasilya/nomad/commit/946dfaba3849daff0203d3c95d409c81b015fd3b))


### Bug Fixes

* **mobile:** widget chips follow light/dark and show whole names ([a0484d9](https://github.com/knownasilya/nomad/commit/a0484d92d3fedd2d96ed29a190f07ce7ee71119e))

## [1.46.0](https://github.com/knownasilya/nomad/compare/v1.45.0...v1.46.0) (2026-11-08)


### Features

* **assets:** turn the family album into Assets, a place for any file in a Space ([85f5342](https://github.com/knownasilya/nomad/commit/85f5342ffe00870fb26b2f62059cbca767d84dfd))
* **calendar:** reminders that reach everyone who sees the event, on desktop and the phone ([800f5b3](https://github.com/knownasilya/nomad/commit/800f5b35c09d0be6e2eccf232a5d7cdcb9a15b44))
* **calendar:** time pickers for events on desktop and the phone ([350382f](https://github.com/knownasilya/nomad/commit/350382f14cde96e45358859d049a667d6ce04435))
* Cmd/Ctrl+K command palette on desktop ([bb03f21](https://github.com/knownasilya/nomad/commit/bb03f21ccaed06448cb6dd6b492dc6abcac3d916))
* **desktop:** OS notifications for Jobs, Space notices and waiting prompts ([409bb7a](https://github.com/knownasilya/nomad/commit/409bb7a437d163dc6cf5d5d0edab4c8dac6a0361))
* household contacts, a shared Space's address book, on desktop, the phone and the AI ([c166253](https://github.com/knownasilya/nomad/commit/c16625352cc78d77d01681861d215e512583793b))
* **jobs:** Stop a running Job and watch its progress on the Jobs page ([8f52ce9](https://github.com/knownasilya/nomad/commit/8f52ce914cb486d955777dfbcb3db2c5a1eb3c20))
* **mobile:** invite people to a shared Space and join with an invite link (ADR-0040) ([6b923c5](https://github.com/knownasilya/nomad/commit/6b923c5e868d546cbdaebc87bedd29dd132b97fe))
* names in the command palette, and # to search only names ([83bc036](https://github.com/knownasilya/nomad/commit/83bc036fe60fff556e340c40c3dda207b36e085f))
* **personas:** every vouch needs a note ([0c030b6](https://github.com/knownasilya/nomad/commit/0c030b6db415b5f9304fb2f483ea2fdc243941bd))
* **personas:** open a logged-in site from its row ([b165f90](https://github.com/knownasilya/nomad/commit/b165f905b38ed24b23d46aef56833077689ec2cc))
* **personas:** vouches, "I've had this person over at my home" (ADR-0045) ([0761f5e](https://github.com/knownasilya/nomad/commit/0761f5e493801a7c0de6b8769187219e82dbb37e))
* **sharing:** Space invite links on desktop, phone backend for inviting (ADR-0040) ([cdd324f](https://github.com/knownasilya/nomad/commit/cdd324f0988157c28ae6defc58f7c48e9ca835a6))
* **shell:** a private file picker that hands out capability URLs ([40bc0dd](https://github.com/knownasilya/nomad/commit/40bc0ddea2aa21d14d90b5bd5cb5445643115104))
* **shell:** pages always get capabilities from the file picker ([04d055d](https://github.com/knownasilya/nomad/commit/04d055dbd681b54efc75730c1f8cb3c2d0887188))


### Bug Fixes

* **assets:** drop the nomad://photos redirect ([7677485](https://github.com/knownasilya/nomad/commit/7677485e7d7cd6bf11583c47e3d03a9ba478f0ce))
* **calendar:** show times on a 12-hour clock ([3f0e12c](https://github.com/knownasilya/nomad/commit/3f0e12c71fbb479dd5ad006132cbef6559b5aa06))
* **fs:** read drives through nomad.capabilities URLs on both backends ([cf80a2e](https://github.com/knownasilya/nomad/commit/cf80a2e1b07a11b4c83ee50a195b5f7a23dd44d7))
* **library:** readable invite link in dark mode, phone icon, clearer contact buttons ([e3dc754](https://github.com/knownasilya/nomad/commit/e3dc754ca68140b7aa212ef5746da9b505ced6a8))
* **personas:** say "vouched for you" instead of "had you over" ([b84bcc3](https://github.com/knownasilya/nomad/commit/b84bcc3c129b8f05b0e7d04adee027e95d98889f))
* **test:** find the repo from vitest.config.js's own location ([4090f97](https://github.com/knownasilya/nomad/commit/4090f97054682d088b1cf86dd56c8e115a79acd8))

## [1.45.0](https://github.com/knownasilya/nomad/compare/v1.44.0...v1.45.0) (2026-11-06)


### Features

* **calendar:** follow calendar drives (walled.garden/calendar) beside iCal feeds ([c10a20b](https://github.com/knownasilya/nomad/commit/c10a20b377a65c16962384f5672289c7c9fd91c1))
* **sharing:** split the Sharing page into This Space and Other Spaces ([0b4faf0](https://github.com/knownasilya/nomad/commit/0b4faf004f812f6df13d4b0a3fd71446ac839204))
* **spaces:** rename, recolor, delete and leave Spaces on desktop and the phone ([c89c62a](https://github.com/knownasilya/nomad/commit/c89c62a146fb63d6bf522056f85380c42e0c7e5d))


### Bug Fixes

* **ai-sidebar:** use the browser's own right-click menu in the shell ([2d70653](https://github.com/knownasilya/nomad/commit/2d70653328720e6400784e6e8bc62d332770ed24)), closes [#172](https://github.com/knownasilya/nomad/issues/172)
* **desktop:** show the running version on the new tab notice ([405670c](https://github.com/knownasilya/nomad/commit/405670c0c50c02b311ddcd2843f3eb8f7429d7bc))
* **settings:** link How to run a Peer to nomad.pages.dev ([d2d113b](https://github.com/knownasilya/nomad/commit/d2d113b97d70ed9fa083955d07699ff154fdd42f))

## [1.44.0](https://github.com/knownasilya/nomad/compare/v1.43.1...v1.44.0) (2026-11-06)


### Features

* **calendar:** a family calendar on desktop and the phone ([b77e106](https://github.com/knownasilya/nomad/commit/b77e106031a8e8baed098b47644c7a0fa6779021))
* **notes:** live Notes between the people of a shared Space ([2d348b1](https://github.com/knownasilya/nomad/commit/2d348b13896493aa558cb53a146f6f7b6324a79b))
* **peer:** an always-on Peer that keeps your Spaces online ([b1cc1ea](https://github.com/knownasilya/nomad/commit/b1cc1ea816cdbda0712480b782d781326b184a1a))
* **photos:** a family album in a shared Space, from the phone and desktop ([77c322e](https://github.com/knownasilya/nomad/commit/77c322edf1d23e85743cde34e1d847c440a77dfb))


### Bug Fixes

* **ai-sidebar:** show a copy/paste menu on right-click in the shell window ([7dd185b](https://github.com/knownasilya/nomad/commit/7dd185b3823fba414f1f08c601afabf581b0ac4b))

### [1.43.1](https://github.com/knownasilya/nomad/compare/v1.43.0...v1.43.1) (2026-11-06)


### Bug Fixes

* **spaces:** stop adding other Devices' Vault keys to Space Root Drives ([67a0e75](https://github.com/knownasilya/nomad/commit/67a0e755a679edad47e76acca234618c2cc73736))

## [1.43.0](https://github.com/knownasilya/nomad/compare/v1.42.0...v1.43.0) (2026-11-06)


### Features

* household features: task lists, Set up a home, Jobs that notify a shared Space ([939d67a](https://github.com/knownasilya/nomad/commit/939d67abb2149d02eb6018b6cb93307f2135c742))


### Bug Fixes

* **notes:** show the phone's cursor and selection on the computer every time ([e8a622b](https://github.com/knownasilya/nomad/commit/e8a622b4e71d4a8f3b0ea8dbb3fd1c5d11b93905))
* **settings:** show the Auto Updater heading once ([8539a1e](https://github.com/knownasilya/nomad/commit/8539a1eddc91b7bc92f468ad3bcbec1e4bf1d2a4))

## [1.42.0](https://github.com/knownasilya/nomad/compare/v1.41.1...v1.42.0) (2026-11-05)


### Features

* **mobile:** live note editing on the phone ([f97b503](https://github.com/knownasilya/nomad/commit/f97b503cf6db8acd49cdd418cf21e1ad1b85b1c0))


### Bug Fixes

* **shell:** mute the Nomad mark in the URL bar to a gray ([3e26689](https://github.com/knownasilya/nomad/commit/3e2668994f0445876773bed4d3e08a03cd1219dd))
* **shell:** show the Nomad mark, not Beaker's, in the URL bar on nomad:// pages ([b303e44](https://github.com/knownasilya/nomad/commit/b303e446d257dfba0a4569abc4690c95238ce34a))

### [1.41.1](https://github.com/knownasilya/nomad/compare/v1.41.0...v1.41.1) (2026-11-04)


### Bug Fixes

* package yjs, y-protocols and lib0 with the desktop app ([3dd704f](https://github.com/knownasilya/nomad/commit/3dd704f1b6ffd6cb94c0e2baf63a2a85c96f6693))

## [1.41.0](https://github.com/knownasilya/nomad/compare/v1.40.0...v1.41.0) (2026-11-04)


### Features

* **notes:** live editing — the AI types into an open note with its own cursor, and your devices edit it together ([5857b7d](https://github.com/knownasilya/nomad/commit/5857b7d4b1f76e59a9a363f6f788a8ec7958e1ee))

## [1.40.0](https://github.com/knownasilya/nomad/compare/v1.39.2...v1.40.0) (2026-11-04)


### Features

* **ai:** a scratch space for what the AI looks up ([1cd4f3d](https://github.com/knownasilya/nomad/commit/1cd4f3d7e6b3fe428f5f28e50224b9f230154246))
* **ai:** allow a site for 3 months, manage it on nomad://ai/sites, and warn when a request sends a secret ([3c0eab3](https://github.com/knownasilya/nomad/commit/3c0eab3308f317b77b114cec38e2f0b8bd6c9fc7))
* **ai:** read long Notes, posts and pages in parts ([01b77bb](https://github.com/knownasilya/nomad/commit/01b77bbb7a43d7348d807bdd3bcb2cc42891ecf4))
* **ai:** show the URL and request in the AI's send-data prompt ([6ce0821](https://github.com/knownasilya/nomad/commit/6ce0821cf1db38cb281d4d4cba0e764aca848a2c))
* **notes:** pick topics from a dropdown, several at once ([68ef496](https://github.com/knownasilya/nomad/commit/68ef496f5218d1c2da972ef3b863174db3661763))


### Bug Fixes

* **ai:** give execute modules parsed results and let helpers sit outside main ([b994a4d](https://github.com/knownasilya/nomad/commit/b994a4d853f9aba2b369314728117d678a7f8b57))
* name what's open in the tab title in Reader, Messages and History ([aca751a](https://github.com/knownasilya/nomad/commit/aca751a8d2c5ce5f47ccdadf4f34e2c4e8075964))
* **notes:** name the open note in the tab title ([41bfb3e](https://github.com/knownasilya/nomad/commit/41bfb3e2290cfc7aa16ebfd9fcaf56c9b80cccaf))

### [1.39.2](https://github.com/knownasilya/nomad/compare/v1.39.1...v1.39.2) (2026-11-04)


### Bug Fixes

* **mobile:** the app no longer closes at launch since Messages (1.39.0) ([3c2dab2](https://github.com/knownasilya/nomad/commit/3c2dab22e3db1ed916bbfab002bb9c4b14e926c2))

### [1.39.1](https://github.com/knownasilya/nomad/compare/v1.39.0...v1.39.1) (2026-11-03)


### Bug Fixes

* **library:** tidy the Persona editor into one ordered column ([0513e2c](https://github.com/knownasilya/nomad/commit/0513e2c190760f0494c7c2e3b44156f493c16348))
* **mobile:** a back swipe no longer opens a new tab stuck in the address bar ([0cbd87f](https://github.com/knownasilya/nomad/commit/0cbd87f43ebc03dfda8245120e6723d554ef004f))

## [1.39.0](https://github.com/knownasilya/nomad/compare/v1.38.0...v1.39.0) (2026-11-03)


### Features

* **ai:** watch a Job's run in the AI sidebar ([44b9614](https://github.com/knownasilya/nomad/commit/44b9614fed9d900cb13ffb90da6c0b1988cddac9))
* **inbox:** direct messages to a Persona, on desktop (ADR-0036) ([1149e49](https://github.com/knownasilya/nomad/commit/1149e49bb2e7435a249dae298790137b3f2bff30))
* **mobile:** Messages on the phone (ADR-0036 step 3) ([daceaa0](https://github.com/knownasilya/nomad/commit/daceaa027ac22b1099e70b17442ccd3c381fe49b))


### Bug Fixes

* **messages:** link to the Messages guide on nomad.dev ([5e91cec](https://github.com/knownasilya/nomad/commit/5e91cec3433a76c85bd14317368ec7010462745c))

## [1.38.0](https://github.com/knownasilya/nomad/compare/v1.37.0...v1.38.0) (2026-11-02)


### Features

* **sidebar:** keep pinned tiles and New tab in view while tabs scroll ([24c5eb3](https://github.com/knownasilya/nomad/commit/24c5eb3edebabca98ca595186e3a0bcf1df39b36))
* **ui:** give every icon-only button a tooltip, and check for it ([78799ee](https://github.com/knownasilya/nomad/commit/78799ee6fef471e9179b40632f1e594707718301))

## [1.37.0](https://github.com/knownasilya/nomad/compare/v1.36.0...v1.37.0) (2026-11-02)


### Features

* **sidebar:** put New tab and new tabs at the top of the tab list ([38ac832](https://github.com/knownasilya/nomad/commit/38ac832aa8e23d8104677599ad0bc6b2c76e2a8c))
* **split:** drag tabs into a split view, and pick a tab for one ([70d933a](https://github.com/knownasilya/nomad/commit/70d933af9680981aa1f9b4fca8905bedf083d7d2))
* **split:** pick a tab to split with from the pane menu, not a new button ([849e448](https://github.com/knownasilya/nomad/commit/849e4488f45560d26bd41523f6e72f519ebfba72))
* **tabs:** show a speaker on tabs playing sound, click it to mute ([849a154](https://github.com/knownasilya/nomad/commit/849a15410675893bbc3f0d6f5854bbde64d95a2b))


### Bug Fixes

* **library:** name the open page, and the open item, in the tab title ([9674de6](https://github.com/knownasilya/nomad/commit/9674de6d2ed8ee0838e6ff7662307024a1d9c87a))
* **menus:** close the Spaces menu and other popups on a press outside them ([9b2174a](https://github.com/knownasilya/nomad/commit/9b2174afe95eb7adfae86171443632c630ab7e94))

## [1.36.0](https://github.com/knownasilya/nomad/compare/v1.35.0...v1.36.0) (2026-11-02)


### Features

* **ai:** let the user's AI and AI Jobs create a drive ([8806616](https://github.com/knownasilya/nomad/commit/880661624a582d51985d18fa59450e85d004db32))
* **jobs:** a run history per AI Job, with errors, search and Clear ([e40e9c4](https://github.com/knownasilya/nomad/commit/e40e9c4a20e371d53aa4cb61acadcc4cb5018751))
* **jobs:** let an AI Job open web pages and click and type on them ([543414a](https://github.com/knownasilya/nomad/commit/543414ae4eefb8734d3dbe6d3a2ef2d257e18df1))
* **mobile:** one Recent row per site visited back to back ([f44ac96](https://github.com/knownasilya/nomad/commit/f44ac960092da0f18feccf857c32491e63ac7420))
* **onboarding:** offer to make the first Persona, skippable ([9eed1b4](https://github.com/knownasilya/nomad/commit/9eed1b46a265dab677742bac55340673cc757f92))
* **personas:** give the location bar's Persona icon its own menu ([fd70f46](https://github.com/knownasilya/nomad/commit/fd70f460721719a21255eaed8c931acbecd7b9c8))
* **personas:** open the Persona menu from the Spaces button's picture ([45ca9b2](https://github.com/knownasilya/nomad/commit/45ca9b2a1fc2c01c3ababbda15e3388335355849))


### Bug Fixes

* **ai:** ask before sending private data to a site the user didn't name ([64e174c](https://github.com/knownasilya/nomad/commit/64e174c783f0217b944f13c9202c1ed2258ceba3))

## [1.35.0](https://github.com/knownasilya/nomad/compare/v1.34.0...v1.35.0) (2026-11-02)


### Features

* **personas:** edit a Persona on any device ([b81f2ef](https://github.com/knownasilya/nomad/commit/b81f2ef212c260621d9901b78047c5887604f7a9))
* **personas:** make a Persona on the phone ([82bbc16](https://github.com/knownasilya/nomad/commit/82bbc16f7f3662bcf53d42e18b45d83a2743c0b6))

## [1.34.0](https://github.com/knownasilya/nomad/compare/v1.33.0...v1.34.0) (2026-11-02)


### Features

* **personas:** Personas and Sessions (ADR-0031) ([f304a30](https://github.com/knownasilya/nomad/commit/f304a309cd81ffd2cc15e8e81eece8c2970ada35))
* **personas:** sites can ask for the Persona's email ([0459497](https://github.com/knownasilya/nomad/commit/045949764f5f20785d78fc8d9a1c355406aeaf07))

## [1.33.0](https://github.com/knownasilya/nomad/compare/v1.32.0...v1.33.0) (2026-11-02)


### Features

* **ai:** link the things the AI makes or changes, on desktop and phone ([601822a](https://github.com/knownasilya/nomad/commit/601822a04abbc084d9c0207dfdc6ef44f549a422))
* **canvas:** titles grow slower than the canvas when zooming in ([555c8c3](https://github.com/knownasilya/nomad/commit/555c8c30eb4bde954bf1bdeb115ccb5b3de605e3))
* **mobile:** Reader's add feed in the header, and Load more for long lists ([13f52ea](https://github.com/knownasilya/nomad/commit/13f52ea951625d909a9c4105de22509e81667ad6))
* **reader,notes:** search Reader and Notes, in the list and on the canvas ([0864e06](https://github.com/knownasilya/nomad/commit/0864e066d58de9b5d57825fc7542d8b50ac04788))


### Bug Fixes

* **reader:** show a feed's posts when you pick it on the phone ([1419b2a](https://github.com/knownasilya/nomad/commit/1419b2a77a8e68e59f84a439448ceaa11443ade5))

## [1.32.0](https://github.com/knownasilya/nomad/compare/v1.31.3...v1.32.0) (2026-11-01)


### Features

* **notes:** topics on notes, sorted by the AI, as hubs on the canvas ([5818619](https://github.com/knownasilya/nomad/commit/58186191279dea164eb5a7e42e7e7f1323355b40))

### [1.31.3](https://github.com/knownasilya/nomad/compare/v1.31.2...v1.31.3) (2026-11-01)


### Bug Fixes

* **ai:** keep the AI cursor above the page's modals and menus ([bfdcb27](https://github.com/knownasilya/nomad/commit/bfdcb277d05969479cedf30bec08719f1bc85a8e))

### [1.31.2](https://github.com/knownasilya/nomad/compare/v1.31.1...v1.31.2) (2026-10-31)


### Bug Fixes

* **mobile:** give web pages a white canvas in dark mode ([3a11168](https://github.com/knownasilya/nomad/commit/3a11168a535906b23d13168f8bbaacc9826c8440))

### [1.31.1](https://github.com/knownasilya/nomad/compare/v1.31.0...v1.31.1) (2026-10-31)


### Bug Fixes

* **mobile:** build the sign-in popup window on Android ([9ac0cef](https://github.com/knownasilya/nomad/commit/9ac0cefce8621fb32e8e427cdf5d9808a244e84e))

## [1.31.0](https://github.com/knownasilya/nomad/compare/v1.30.0...v1.31.0) (2026-10-31)


### Features

* **ai:** manage skills on the AI page ([196d659](https://github.com/knownasilya/nomad/commit/196d6590c2b0bca25c7d736aa8bc8b5cc9befc35))


### Bug Fixes

* **mobile:** keep sign-in popups, new-window links and feeds inside Nomad ([195ac01](https://github.com/knownasilya/nomad/commit/195ac0189ffbbc9667164d6c33a2511285edc654))

## [1.30.0](https://github.com/knownasilya/nomad/compare/v1.29.0...v1.30.0) (2026-10-31)


### Features

* **ai:** an AI page with the sidebar's chats, memory and setup ([4ec6765](https://github.com/knownasilya/nomad/commit/4ec676555e482632c9415939c8146261d720a998))
* **ai:** secrets the AI and Jobs use by name, without seeing them ([1e68d26](https://github.com/knownasilya/nomad/commit/1e68d26887c9c99151b63b07e61e7895c9277ec9))
* **jobs:** let AI Jobs change drives, Notes and Reader they were given ([f581b9b](https://github.com/knownasilya/nomad/commit/f581b9b34ddb2ff4c226c0914a98672ca7caee51))
* **notes:** bring the Notes canvas to the phone ([747df07](https://github.com/knownasilya/nomad/commit/747df070c4db4bcf2d0e348b274e56f1715b087e))
* **notes:** keep a new note in the current Space ([132515b](https://github.com/knownasilya/nomad/commit/132515b93b41a77f514a6f3da55fb69dfe76cc0b))
* **notes:** show which way each link points on the canvas ([4edb874](https://github.com/knownasilya/nomad/commit/4edb8742594ffdcc8ead0274ed03fc75f36a7fd0))
* **reader:** a canvas of saved articles around their AI topics, on desktop and phone ([222d0c3](https://github.com/knownasilya/nomad/commit/222d0c3fc033b78bd9f810042ae8760a2798f758))
* **reader:** follow RSS and Atom feeds, and sort their posts into topics ([873409f](https://github.com/knownasilya/nomad/commit/873409f55378da36d67116cd7029224f09e35a56))
* **reader:** save any web page, sort it into topics with AI, and read it in a minimal view ([2cf01d7](https://github.com/knownasilya/nomad/commit/2cf01d793a9fa5d549db2d4ed0c8da20e6900722))


### Bug Fixes

* **mobile:** keep bottom sheets above the keyboard on Android ([e2b6f76](https://github.com/knownasilya/nomad/commit/e2b6f760c2081fdfc56d0201c38e5eb25fb965a2))
* **mobile:** the top bar keeps still and the address stays readable when tapped ([5ceeac3](https://github.com/knownasilya/nomad/commit/5ceeac361b93b9c8c141f6fbeb2030a5d5d00e6f))
* **reader:** point the no-AI note at nomad://ai/setup, where the AI settings moved ([4a17047](https://github.com/knownasilya/nomad/commit/4a17047c195725a0737af92364d6598a754a48fa))
* **sidebar:** show a tooltip with the site's name and address on pinned tiles ([69a90ce](https://github.com/knownasilya/nomad/commit/69a90cefa138b4681778b6eb3795d570fc56eb41))
* **site-info:** let the name and ask-to-edit forms submit ([973fc61](https://github.com/knownasilya/nomad/commit/973fc616fe855fa28d925061c43f20492a1e1c17))

## [1.29.0](https://github.com/knownasilya/nomad/compare/v1.28.0...v1.29.0) (2026-10-31)


### Features

* **ai:** let the AI show a plan of page clicks the user approves once ([ae4a93c](https://github.com/knownasilya/nomad/commit/ae4a93cf708a0a1264d4c3bafe54087be26199e8))
* **ai:** let the user allow similar page clicks for the rest of a chat ([5acce51](https://github.com/knownasilya/nomad/commit/5acce51f9bd14124562ebf1456af3eb826a5eb15))
* **ai:** send a queued message to the assistant now ([59ba997](https://github.com/knownasilya/nomad/commit/59ba997023025238e1ae668714abb06d082e174f))
* **mobile:** recent-sites card instead of the address bar dropdown ([4810471](https://github.com/knownasilya/nomad/commit/4810471206fb96d37b9623dc03972af3b0688af1))
* **pins:** sync a Space's pinned pages and show them as icon tiles ([b367b47](https://github.com/knownasilya/nomad/commit/b367b47d9095ece8609575fac0133ebd1a68f9b6))

## [1.28.0](https://github.com/knownasilya/nomad/compare/v1.27.0...v1.28.0) (2026-10-31)


### Features

* **mobile:** one top bar, pages flush to the bottom, site theme colors ([72963a2](https://github.com/knownasilya/nomad/commit/72963a20f88e9605f49e98203c907823619d5390))
* **mobile:** touch and hold the tab count to open a new tab ([f785661](https://github.com/knownasilya/nomad/commit/f7856614afdd998de491c630cfd66b0731f17f49))


### Bug Fixes

* **mobile:** let the phone write Spaces synced from desktop ([b1c8686](https://github.com/knownasilya/nomad/commit/b1c8686ced07b1077a3864bd918103f663418ec7))
* **mobile:** return a value from NomadWebViewInsets.install so the module compiles ([556a124](https://github.com/knownasilya/nomad/commit/556a1242ed503aecee8a5b056755c2ca6ca3b9e4))

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
