#!/usr/bin/env node
'use strict';

var pathUtil = require('path');
var { execFileSync } = require('child_process');
var bundle = require('./tasks/build/bundle');

var appDir = pathUtil.resolve(__dirname, '../app');
var fgDir = pathUtil.join(appDir, 'fg');
var userlandDir = pathUtil.join(appDir, 'userland');
var p = (base, rel) => pathUtil.join(base, rel);

// Generate the editor's schema type declarations from the Zod schemas. Must run
// before the editor bundle is built so it can import the generated module.
function genSchemaTypes() {
  execFileSync(process.execPath, [pathUtil.join(__dirname, 'gen-schema-dts.mjs')], {
    stdio: 'inherit',
  });
}

function bundleApplication() {
  genSchemaTypes();
  return Promise.all([
    bundle(p(appDir, 'main.js'), p(appDir, 'main.build.js')),
    bundle(p(fgDir, 'webview-preload/index.js'), p(fgDir, 'webview-preload/index.build.js'), {
      browserify: true,
    }),
    bundle(p(fgDir, 'shell-window/index.js'), p(fgDir, 'shell-window/index.build.js'), {
      browserify: true,
    }),
    bundle(p(fgDir, 'shell-menus/index.js'), p(fgDir, 'shell-menus/index.build.js'), {
      browserify: true,
    }),
    bundle(p(fgDir, 'location-bar/index.js'), p(fgDir, 'location-bar/index.build.js'), {
      browserify: true,
    }),
    bundle(p(fgDir, 'prompts/index.js'), p(fgDir, 'prompts/index.build.js'), { browserify: true }),
    bundle(p(fgDir, 'perm-prompt/index.js'), p(fgDir, 'perm-prompt/index.build.js'), {
      browserify: true,
    }),
    bundle(p(fgDir, 'modals/index.js'), p(fgDir, 'modals/index.build.js'), { browserify: true }),
    bundle(p(fgDir, 'json-renderer/index.js'), p(fgDir, 'json-renderer/index.build.js'), {
      browserify: true,
    }),
    bundle(p(fgDir, 'chat-bubble/index.js'), p(fgDir, 'chat-bubble/index.build.js'), {
      browserify: true,
    }),
    bundle(p(userlandDir, 'site-info/js/main.js'), p(userlandDir, 'site-info/js/main.build.js'), {
      browserify: true,
    }),
    bundle(p(userlandDir, 'editor/js/main.js'), p(userlandDir, 'editor/js/main.build.js'), {
      browserify: true,
    }),
    bundle(p(userlandDir, 'explorer/js/main.js'), p(userlandDir, 'explorer/js/main.build.js'), {
      browserify: true,
    }),
    bundle(p(userlandDir, 'settings/js/main.js'), p(userlandDir, 'settings/js/main.build.js'), {
      browserify: true,
    }),
  ]);
}

module.exports = { bundleApplication };

if (require.main === module) {
  var start = Date.now();
  bundleApplication()
    .then(function () {
      console.log('Build complete (' + (Date.now() - start) + 'ms)');
    })
    .catch(function (err) {
      console.error('Build failed:', err);
      process.exit(1);
    });
}
