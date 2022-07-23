# Contribute

## Introduction

Thanks for considering contributing to Nomad!

We welcome any type of contribution, not only code. You can help with

- **QA**: file bug reports, the more details you can give the better (e.g. screenshots with the console open)
- **Community**: presenting the project at meetups, organizing a dedicated meetup for the local community, ...
- **Code**: take a look at the [open issues](https://github.com/knownasilya/nomad/issues). Even if you can't write code, commenting on them, showing that you care about a given issue matters. It helps us triage them.

Looking to work on Nomad? [Watch this video](https://www.youtube.com/watch?v=YuE9OO-ZDYo) and take a look at [the build notes](./build-notes.md).

## Building from source

Requires node 14 or higher. We recommend installing volta (https://volta.sh) to manage node versions.

In Linux (and in some cases macOS) you need libtool, m4, and automake:

```bash
sudo apt-get install libtool m4 make g++  # debian/ubuntu
sudo dnf install libtool m4 make gcc-c++  # fedora
```

In Windows, you'll need to install [Python 2.7](https://www.python.org/downloads/release/python-2711/), Visual Studio 2015 or 2017, and [Git](https://git-scm.com/download/win). (You might try [windows-build-tools](https://www.npmjs.com/package/windows-build-tools).) Then run:

```powershell
npm config set python c:/python27
npm config set msvs_version 2015
npm install -g node-gyp
npm install -g gulp
```

To build:

```bash
git clone https://github.com/knownasilya/nomad.git
cd nomad/scripts
npm install
npm run rebuild # see https://github.com/electron/electron/issues/5851
npm start
```

If you pull latest from the repo and get weird module errors, do:

```bash
npm run burnthemall
```

This will torch your `node_modules/`, and do the full install/rebuild process for you.
`npm start` should work afterwards.

If you're doing development, `npm run watch` to have assets build automatically.

### Debugging

To debug the background process start electron with the `--inspect` argument pointing to the `app` directory, e.g. `script/node_modules/.bin/electron --inspect app`. You can then attach an external debugger (e.g. Chrome devtools).

To debug the shell window itself (i.e. the beaker browser chrome), press `CmdOrCtrl+alt+shift+I` to open the devtools.

To debug a built-in pages (e.g. the Settings or Library pages), press `CmdOrCtrl+shift+I` to open the devtools.

## Submitting code

Any code change should be submitted as a pull request. The description should explain what the code does and give steps to execute it. The pull request should also contain tests, if applicable. For example, a PR that changes a part of the Nomad UI will likely not need tests, but a PR that updates Nomad's networking stack would.

## Code review process

The bigger the pull request, the longer it will take to review and merge. Try to break down large pull requests in smaller chunks that are easier to review and merge.

It is also always helpful to have some context for your pull request. What was the purpose? Why does it matter to you?

## Questions

If you have any questions, create an [issue](https://github.com/knownasilya/nomad/issues) (protip: do a quick search first to see if someone else didn't ask the same question before!).

## Credits

### Contributors

Thank you to all the people who have already contributed to Nomad and beaker in the past!

<!-- This `CONTRIBUTING.md` is based on @nayafia's template https://github.com/nayafia/contributing-template -->
