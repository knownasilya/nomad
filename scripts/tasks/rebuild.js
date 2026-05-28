#!/usr/bin/env node
'use strict';

var path = require('path');
var run = require('./util-run');
var homedir = require('os').homedir();

function runAsync(...args) {
  return new Promise((resolve) => {
    run(...args, resolve);
  });
}

const MODULES_NEEDING_REBUILD = ['sqlite3'];

async function main() {
  // TODO read electron version
  var cwd = path.join(__dirname, '../../app');
  console.log(cwd);
  var env = {};
  if (process.platform === 'darwin') {
    env = {
      // required to make spellchecker compile
      CXXFLAGS: '-mmacosx-version-min=10.10',
      LDFLAGS: '-mmacosx-version-min=10.10',
    };
  }
  env.HOME = path.join(homedir, '.electron-gyp');
  for (let mod of MODULES_NEEDING_REBUILD) {
    await runAsync(
      `npm rebuild ${mod} --runtime=electron --target=11.0.0-beta.18 --disturl=https://electronjs.org/headers --build-from-source`,
      { cwd, env, shell: true }
    );
  }
  await runAsync(`npm run build`, { shell: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
