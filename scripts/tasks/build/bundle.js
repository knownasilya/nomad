'use strict';

var pathUtil = require('path');
var fs = require('fs');
var jetpack = require('fs-jetpack');
var rollup = require('rollup');
var Q = require('q');

var nodeBuiltInModules = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'zlib',
];

var electronBuiltInModules = ['electron'];

var npmModulesUsedInApp = function () {
  var appManifest = require('../../../app/package.json');
  return Object.keys(appManifest.dependencies);
};

// Main process: externalize everything (Node + Electron + npm deps).
// Node resolves them at runtime from app/node_modules.
var generateMainExternalsList = function () {
  return [].concat(
    nodeBuiltInModules,
    electronBuiltInModules,
    npmModulesUsedInApp()
  );
};

// Frontend preloads: only externalize electron.
// Node built-ins must be bundled as browser polyfills because some windows
// run with sandbox:true where require('stream') etc. are not available.
// npm packages must also be bundled because Electron's sandboxed preload
// require() resolver does not find app/node_modules.
var generateFrontendExternalsList = function () {
  return electronBuiltInModules.slice();
};

// Resolves `import x from './foo.css'` → `./foo.css.js` and
// `import x from './img.jpg'` → `./img.jpg.js` when the .js file exists.
// This is needed because the codebase stores Lit css`` templates in *.css.js
// files and pre-encoded images in *.jpg.js files, but imports them without
// the .js suffix.
function cssJsPlugin() {
  return {
    name: 'css-js-asset-js',
    enforce: 'pre',
    resolveId: function (id, importer) {
      if (!importer) return null;
      if (!/^\.\.?\//.test(id)) return null;
      if (/\.(css|jpg|jpeg|png|gif|svg|webp)$/.test(id)) {
        var resolved = pathUtil.resolve(pathUtil.dirname(importer), id + '.js');
        if (fs.existsSync(resolved)) return resolved;
      }
      return null;
    },
  };
}

module.exports = function (src, dest, opts) {
  // Main process bundle: plain Rollup, no browser concerns
  if (!opts || !opts.browserify) {
    var deferred = Q.defer();

    rollup
      .rollup({
        input: src,
        external: generateMainExternalsList(),
        onwarn(warning, warn) {
          if (warning.code === 'UNRESOLVED_IMPORT') return;
          if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return;
          if (warning.code === 'CIRCULAR_DEPENDENCY') return;
          warn(warning);
        },
      })
      .then(async function (bundle) {
        var jsFile = pathUtil.basename(dest);
        var result = await bundle.generate({
          format: 'cjs',
          output: {
            sourceMap: !!(opts && opts.sourcemap),
            sourceMapFile: jsFile,
          },
        });

        var isolatedCode = '(function () {' + result.output[0].code + '\n}());';
        if (opts && opts.sourcemap) {
          return Q.all([
            jetpack.writeAsync(
              dest,
              isolatedCode + '\n//# sourceMappingURL=' + jsFile + '.map'
            ),
            jetpack.writeAsync(dest + '.map', result.output[0].map.toString()),
          ]);
        }
        return jetpack.writeAsync(dest, isolatedCode);
      })
      .then(function () {
        deferred.resolve();
      })
      .catch(function (err) {
        if (err.code === 'PARSE_ERROR') {
          console.log(err.loc);
          console.log(err.frame);
        }
        deferred.reject(err);
      });

    return deferred.promise;
  }

  // Frontend bundles (fg/ preloads and userland/ scripts): use Vite
  return Promise.all([import('vite'), import('vite-plugin-node-polyfills')]).then(function (modules) {
    var vite = modules[0];
    var nodePolyfills = modules[1].nodePolyfills;
    var external = generateFrontendExternalsList();
    var destDir = pathUtil.dirname(dest);
    var destFile = pathUtil.basename(dest);
    // Use the app/ directory as root so outDir (a subdir) doesn't trigger
    // Vite's warning about outDir being the same as or a parent of root.
    var appDir = pathUtil.resolve(__dirname, '../../../app');

    // Resolve shim absolute paths now (in scripts/node_modules context) so
    // that Vite can find and bundle them even though root is app/.
    var processShim = require.resolve('vite-plugin-node-polyfills/shims/process');
    var bufferShim = require.resolve('vite-plugin-node-polyfills/shims/buffer');

    return vite.build({
      root: appDir,
      logLevel: 'warn',
      plugins: [
        nodePolyfills({
          // Don't re-declare process/Buffer/global — Electron's preload context
          // already has them and a top-level const re-declaration causes SyntaxError.
          globals: { Buffer: false, global: false, process: false },
        }),
        cssJsPlugin(),
      ],
      resolve: {
        // Point shim imports to absolute paths so Rollup bundles them
        // rather than leaving them as require() calls that can't resolve
        // from the preload's directory at runtime.
        alias: [
          { find: 'vite-plugin-node-polyfills/shims/process', replacement: processShim },
          { find: 'vite-plugin-node-polyfills/shims/buffer', replacement: bufferShim },
        ],
      },
      build: {
        outDir: destDir,
        emptyOutDir: false,
        minify: false,
        cssCodeSplit: false,
        rollupOptions: {
          input: src,
          external: external,
          onwarn: function (warning, warn) {
            if (warning.code === 'CIRCULAR_DEPENDENCY') return;
            if (warning.code === 'UNRESOLVED_IMPORT') return;
            if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return;
            warn(warning);
          },
          output: {
            format: 'cjs',
            entryFileNames: destFile,
            dir: destDir,
            // Patch process.nextTick in sandboxed Electron contexts where the
            // minimal process object doesn't include it.
            banner: '(function(){if(typeof process!=="undefined"&&typeof process.nextTick!=="function"){process.nextTick=function(fn){var a=[].slice.call(arguments,1);setTimeout(function(){fn.apply(null,a);},0);};}})();',
          },
        },
        define: {
          'process.env.NODE_ENV': JSON.stringify(
            process.env.NODE_ENV || 'production'
          ),
        },
      },
    });
  });
};
