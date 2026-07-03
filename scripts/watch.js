#!/usr/bin/env node
'use strict';

var fs = require('fs');
var pathUtil = require('path');
var { bundleApplication } = require('./build');

var appDir = pathUtil.resolve(__dirname, '../app');

var rebuilding = false;
var dirty = false;

function rebuild() {
  if (rebuilding) {
    dirty = true;
    return;
  }
  rebuilding = true;
  dirty = false;
  var start = Date.now();
  bundleApplication()
    .then(function () {
      console.log('[watch] Rebuilt (' + (Date.now() - start) + 'ms)');
    })
    .catch(function (err) {
      console.error('[watch] Build error:', err.message || err);
    })
    .finally(function () {
      rebuilding = false;
      if (dirty) rebuild();
    });
}

console.log('Building...');
bundleApplication()
  .then(function () {
    console.log('Initial build complete. Watching ' + appDir + ' ...');

    fs.watch(appDir, { recursive: true }, function (event, filename) {
      if (!filename) return;
      if (filename.endsWith('.build.js')) return;
      // Source lives in .js/.mjs and (post TS-migration) .ts/.mts; .css.js assets end in .js.
      if (!/[.](m?js|m?ts)$/.test(filename)) return;
      rebuild();
    });
  })
  .catch(function (err) {
    console.error('Initial build failed:', err);
    process.exit(1);
  });
