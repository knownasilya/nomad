#!/usr/bin/env node
'use strict';

var path = require('path');
var run = require('./util-run');
var { rebuild } = require('@electron/rebuild');

function runAsync(...args) {
  return new Promise((resolve) => {
    run(...args, resolve);
  });
}

async function main() {
  var electronVersion = require('electron/package.json').version;
  var appDir = path.join(__dirname, '../../app');
  console.log('Rebuilding native modules in', appDir);

  await rebuild({
    buildPath: appDir,
    electronVersion,
    force: true,
  });

  await runAsync(`npm run build`, { shell: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
