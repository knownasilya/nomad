#!/usr/bin/env node

const NODE_FLAGS = `--js-flags="--throw-deprecation"`;

var path = require('path');
var childProcess = require('child_process');
var electron = require('electron');

var app = path.resolve(__dirname, '../../app');

module.exports = function () {
  if (process.env.ELECTRON_PATH) {
    electron = process.env.ELECTRON_PATH;
  }
  console.log('Spawning electron', electron);
  childProcess
    .spawn(electron, [/*'--inspect',*/ NODE_FLAGS, app], {
      stdio: 'inherit',
      env: Object.assign({}, process.env, { NOMAD_DEV_MODE: '1' }),
    })
    .on('close', function () {
      // User closed the app. Kill the host process.
      process.exit();
    });
};

if (require.main === module) {
  module.exports();
}
