/*
WebMCP (webview preload, isolated world).

Injects the @mcp-b/webmcp-polyfill into the page's MAIN world so page scripts get a real
`document.modelContext.registerTool(...)` (+ the deprecated `navigator.modelContext` alias),
then bridges the tools the page registers to the AI agent loop in bg/ai.ts:

  main world (polyfill + shim)  ──register({listTools,executeTool})──►  this module (isolated)
                                                                          │ publishTools()  ─► bg
                                       ◄── openInvokeStream() frames ─────┤
                                          resolveInvocation()  ───────────┘ ─► bg

Same technique as ./prompt.js: expose a small object to the main world via contextBridge, then
`webFrame.executeJavaScript` a bootstrap that wires the page-facing surface to it. v1 is
main-frame + secure-context only.

Set `localStorage['nomad-webmcp-debug'] = '1'` (in the page) for verbose console tracing.
*/

import * as rpc from 'pauls-electron-rpc';
import { contextBridge, webFrame } from 'electron';
import errors from 'beaker-error-constants';
import modelContextManifest from '../../bg/web-apis/manifests/external/model-context';
// The polyfill's standalone IIFE, inlined as text — it must run in the main world, which we
// can only reach through webFrame.executeJavaScript(<source string>).
import polyfillIifeSource from '@mcp-b/webmcp-polyfill/iife?raw';

const RPC_OPTS = { timeout: false, errors };
const PUBLISH_DEBOUNCE_MS = 50;

function debugOn() {
  try {
    return window.localStorage && window.localStorage.getItem('nomad-webmcp-debug') === '1';
  } catch {
    return false;
  }
}
function log(...a) {
  if (debugOn()) console.info('[webmcp]', ...a);
}
function warn(...a) {
  console.warn('[webmcp]', ...a);
}

function isEligible() {
  const proto = window.location.protocol;
  const okScheme =
    proto === 'nomad:' ||
    proto === 'hyper:' ||
    proto === 'https:' ||
    (proto === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname));
  if (!okScheme) return false;
  if (!window.isSecureContext) return false;
  if (window.top !== window) return false; // main frame only (v1)
  return true;
}

export function setupModelContext() {
  if (!isEligible()) return;
  log('preload init', window.location.href);

  const mc = rpc.importAPI('model-context', modelContextManifest, RPC_OPTS);

  let host = null; // { listTools(), executeTool(name, argsJson) } — proxied from the main world
  let invokeStream = null;
  let publishTimer = null;

  function publishNow() {
    if (!host) return;
    Promise.resolve()
      .then(() => host.listTools())
      .then((list) => {
        const tools = Array.isArray(list) ? list : [];
        log('publishing', tools.length, 'tool(s):', tools.map((t) => t && t.name).join(', '));
        return mc.publishTools(tools);
      })
      .catch((err) => warn('publish failed', err));
  }

  function schedulePublish() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(publishNow, PUBLISH_DEBOUNCE_MS);
  }

  async function onInvokeFrame(frame) {
    if (!Array.isArray(frame) || frame[0] !== 'invoke') return;
    const { callId, name, argsJson } = frame[1] || {};
    log('invoke', name, argsJson);
    try {
      if (!host) throw new Error('no page tool host');
      const result = await host.executeTool(name, argsJson);
      mc.resolveInvocation({ callId, ok: true, result: toPlain(result) }).catch(() => {});
    } catch (err) {
      warn('invoke failed', name, err);
      mc.resolveInvocation({ callId, ok: false, error: String((err && err.message) || err) }).catch(
        () => {}
      );
    }
  }

  contextBridge.exposeInMainWorld('__nomadWebmcpBridge', {
    // Called once from the bootstrap after the polyfill installs.
    register(api) {
      host = api;
      if (!invokeStream) {
        invokeStream = mc.openInvokeStream();
        invokeStream.on('data', onInvokeFrame);
      }
      log('bridge registered');
      publishNow();
    },
    // Called by the bootstrap on every `toolchange`.
    notifyChange() {
      log('toolchange');
      schedulePublish();
    },
    // Called by the bootstrap with a one-time snapshot of what it found in the main world.
    report(status) {
      log('main-world status', status);
    },
  });

  // No manual teardown on unload: pauls-electron-rpc auto-closes every stream for a
  // webContents on did-navigate / destroyed. Closing it ourselves on `pagehide` races that
  // cleanup and throws inside the RPC layer (streamRequestClose on an already-deleted map).

  webFrame
    .executeJavaScript(
      ORIGIN_AGENT_CLUSTER_SHIM +
        `window.__webMCPPolyfillOptions = { installTestingShim: true };\n` +
        polyfillIifeSource +
        '\n;' +
        MAIN_WORLD_BOOTSTRAP
    )
    .catch((err) => warn('main-world injection failed', err));
}

// The polyfill refuses registerTool() unless the page is origin-keyed
// (`window.originAgentCluster !== false`). That check guards against same-site cross-origin
// pages sharing an agent cluster — a concern that doesn't exist for hyper:// (every drive key
// is a distinct origin with no registrable-domain siblings). Present it as origin-keyed so
// registration is allowed. Runs in the main world before the polyfill IIFE; fully guarded.
const ORIGIN_AGENT_CLUSTER_SHIM = `
try {
  if (window.originAgentCluster === false) {
    Object.defineProperty(window, 'originAgentCluster', {
      configurable: true,
      get: function () { return true; }
    });
  }
} catch (e) {}
`;

// Best-effort structured-clone guard before the result crosses RPC (contextBridge already
// cloned it once on the way in from the main world).
function toPlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

// Runs in the MAIN world, right after the polyfill IIFE. Wires the page-facing modelContext
// (via the testing shim when present, else the core surface) to `window.__nomadWebmcpBridge`.
const MAIN_WORLD_BOOTSTRAP = `
(function () {
  try {
    var bridge = window.__nomadWebmcpBridge;
    if (!bridge) return;

    var testing = navigator.modelContextTesting || null;
    var core = document.modelContext || null;

    var status = {
      polyfillGlobal: typeof window.WebMCPPolyfill !== 'undefined',
      hasCore: !!core,
      coreGetTools: !!(core && typeof core.getTools === 'function'),
      coreExecuteTool: !!(core && typeof core.executeTool === 'function'),
      hasTesting: !!testing,
      testingListTools: !!(testing && typeof testing.listTools === 'function'),
      testingExecuteTool: !!(testing && typeof testing.executeTool === 'function'),
      secureContext: window.isSecureContext,
      originAgentCluster: window.originAgentCluster
    };
    try { bridge.report(status); } catch (e) {}

    if (!testing && !core) {
      // still expose the inspector so a dev can see WHY it's inert
      try {
        window.__nomadWebmcp = { status: status, tools: function () { return Promise.resolve([]); } };
      } catch (e) {}
      return;
    }

    var notify = function () { try { bridge.notifyChange(); } catch (e) {} };
    if (testing && typeof testing.addEventListener === 'function') {
      testing.addEventListener('toolchange', notify);
    } else if (testing) {
      testing.ontoolchange = notify;
    }
    if (core && typeof core.addEventListener === 'function') {
      core.addEventListener('toolchange', notify);
    }

    // Normalise a tool's inputSchema to a clean, cloneable plain object. The polyfill's
    // testing shim returns it as a JSON *string* (getTools() returns an object); accept both.
    // Round-tripping through JSON also strips the page realm's prototype so contextBridge can
    // clone it.
    var cloneSchema = function (s) {
      if (typeof s === 'string') {
        try { s = JSON.parse(s); } catch (e) { return null; }
      }
      if (!s || typeof s !== 'object') return null;
      try { return JSON.parse(JSON.stringify(s)); } catch (e) { return null; }
    };

    var host = {
      listTools: function () {
        var listP, toolsP;
        try {
          listP = Promise.resolve(
            testing && typeof testing.listTools === 'function' ? testing.listTools() : []
          );
        } catch (e) { listP = Promise.resolve([]); }
        try {
          toolsP = Promise.resolve(
            core && typeof core.getTools === 'function' ? core.getTools() : []
          );
        } catch (e) { toolsP = Promise.resolve([]); }

        return Promise.all([listP, toolsP]).then(function (r) {
          var fromTesting = r[0] || [];
          var fromCore = r[1] || [];
          var schemaByName = {};
          fromCore.forEach(function (t) {
            if (t && t.name && t.inputSchema) schemaByName[t.name] = t.inputSchema;
          });
          // getTools() parses inputSchema to an object; listTools() leaves it a string.
          // Prefer core as the base, fall back to the testing shim.
          var base = fromCore.length ? fromCore : fromTesting;
          return base.map(function (t) {
            var schema = (t && t.inputSchema) || schemaByName[t && t.name] || null;
            return {
              name: t && t.name,
              description: (t && t.description) || '',
              inputSchema: cloneSchema(schema)
            };
          });
        });
      },
      executeTool: function (name, argsJson) {
        if (testing && typeof testing.executeTool === 'function') {
          return Promise.resolve(testing.executeTool(name, argsJson, {}));
        }
        if (core && typeof core.executeTool === 'function' && typeof core.getTools === 'function') {
          return Promise.resolve(core.getTools()).then(function (list) {
            var tool = (list || []).find(function (t) { return t && t.name === name; });
            if (!tool) throw new Error('unknown tool: ' + name);
            return core.executeTool(tool, argsJson);
          });
        }
        throw new Error('this page has no executable modelContext');
      }
    };

    bridge.register(host);
    notify();

    // Debug inspector — see nomad.dev/content/docs/api/developers/webmcp.md
    try {
      window.__nomadWebmcp = {
        status: status,
        tools: function () { return host.listTools(); },
        call: function (name, args) {
          return host.executeTool(name, JSON.stringify(args || {}));
        }
      };
    } catch (e) {}
  } catch (e) {
    console.error('[webmcp] bootstrap failed', e);
  }
})();
undefined;
`;
