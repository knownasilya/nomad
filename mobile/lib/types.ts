import type { DriveType } from './hyperUrl'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

// backend -> UI messages (JSON payloads of the RPC_* commands)
export interface StatusMsg {
  tabId: string
  phase: string
  message: string
  peers: number
}

export interface ContentMsg {
  tabId: string
  url: string
  ok: boolean
  key: string
  driveType: DriveType
  title?: string | null // drive title from index.json / index.md / index.html
  isDir: boolean
  mime: string
  path?: string
  entries?: DirEntry[]
  bodyBase64?: string
  http?: string // loopback gateway URL to load in the WebView (files are served, not inlined)
  port?: number // the drive's gateway port, for mapping loopback URLs back to hyper:// ones
  updated?: boolean // a background instant-cache refresh replacing an earlier cached render
}

export interface ErrorMsg {
  tabId: string
  url: string
  message: string
}

export interface LogEntry {
  level: string // log | warn | error | info | debug
  text: string
  ts: number
}

// Injected into every page WebView to forward console output + errors to RN.
export const CONSOLE_SHIM = `(function(){
  if (window.__nomadDevtools) return; window.__nomadDevtools = true;
  function send(level, args){
    try {
      var text = Array.prototype.map.call(args, function(a){
        try { return (typeof a === 'object' && a !== null) ? JSON.stringify(a) : String(a); } catch(e){ return String(a); }
      }).join(' ');
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'console', level:level, text:text}));
    } catch(e){}
  }
  ['log','warn','error','info','debug'].forEach(function(level){
    var orig = console[level];
    console[level] = function(){ send(level, arguments); if (orig) orig.apply(console, arguments); };
  });
  window.addEventListener('error', function(e){ send('error', [e.message + ' (' + (e.filename||'') + ':' + (e.lineno||0) + ')']); });
  window.addEventListener('unhandledrejection', function(e){ send('error', ['Unhandled rejection: ' + ((e.reason && e.reason.message) || e.reason)]); });
  true;
})();`

// Injected into drive WebViews so in-page `nomad.fs.*` calls (used by app frontends like the blog
// template) work on mobile. Exposes the SAME `nomad.fs` surface as desktop (ADR-0010) — the method
// list is the canonical shared/fs-manifest.mjs — over a postMessage bridge to the Bare backend
// (resolved by window.__nomadResolve). Reads work today; writes + writer-management currently
// reject (see backend dispatchNomad) until the mobile Vault exposes writable drives through the bridge.
export const NOMAD_SHIM = `(function(){
  if (window.nomad) return;
  var pending = {}, seq = 0;
  function rpc(method, url, args){
    return new Promise(function(resolve, reject){
      var id = 'b' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'nomad-rpc',
          payload: { id: id, api: 'fs', method: method, url: url || null, args: args || [] }
        }));
      } catch (e) { delete pending[id]; reject(e); }
    });
  }
  window.__nomadResolve = function(id, result){
    var p = pending[id]; if (!p) return; delete pending[id];
    if (result && result.ok) p.resolve(result.value);
    else p.reject(new Error((result && result.error) || 'nomad bridge error'));
  };
  function join(base, path){
    if (!path) return base;
    if (String(path).indexOf('://') !== -1) return path;
    var b = base; while (b.charAt(b.length - 1) === '/') b = b.slice(0, -1);
    var p = String(path); while (p.charAt(0) === '/') p = p.slice(1);
    return b + '/' + p;
  }
  var noopStream = function(){ return { addEventListener: function(){}, removeEventListener: function(){}, close: function(){} }; };
  // Scoped drive handle — paths are relative to the drive (mirrors desktop fg/fs.js).
  function driveApi(url){
    return {
      get url(){ return url; },
      getInfo: function(o){ return rpc('getInfo', url, [o || {}]); },
      entry: function(p, o){ return rpc('entry', join(url, p), [o || {}]); },
      stat: function(p, o){ return rpc('stat', join(url, p), [o || {}]); },
      get: function(p, o){ return rpc('get', join(url, p), [o || {}]); },
      readFile: function(p, o){ return rpc('readFile', join(url, p), [o || {}]); },
      list: function(p, o){ return rpc('list', join(url, p || '/'), [o || {}]); },
      readdir: function(p, o){ return rpc('readdir', join(url, p || '/'), [o || {}]); },
      query: function(p, o){ return rpc('query', join(url, p || '/'), [o || {}]); },
      put: function(p, data, o){ return rpc('put', join(url, p), [data, o || {}]); },
      writeFile: function(p, data, o){ return rpc('writeFile', join(url, p), [data, o || {}]); },
      del: function(p, o){ return rpc('del', join(url, p), [o || {}]); },
      configure: function(info, o){ return rpc('configure', url, [info, o || {}]); },
      createInvite: function(o){ return rpc('createInvite', url, [o || {}]); },
      listRequests: function(){ return rpc('listRequests', url, []); },
      approveRequest: function(k, o){ return rpc('approveRequest', url, [k, o || {}]); },
      denyRequest: function(k){ return rpc('denyRequest', url, [k]); },
      removeWriter: function(k){ return rpc('removeWriter', url, [k]); },
      listWriters: function(){ return rpc('listWriters', url, []); },
      // Draft Mode (ADR-0012) — stage/preview/discard work on mobile; Publish only for owned drives.
      beginDraft: function(){ return rpc('beginDraft', url, []); },
      endDraft: function(){ return rpc('endDraft', url, []); },
      draftStatus: function(){ return rpc('draftStatus', url, []); },
      publishDraft: function(o){ return rpc('publishDraft', url, [o || {}]); },
      discardDraft: function(o){ return rpc('discardDraft', url, [o || {}]); },
      setDraftPreview: function(on){ return rpc('setDraftPreview', url, [on]); },
      watch: noopStream,
      watchRequests: noopStream,
      watchDraft: noopStream
    };
  }
  // nomad.ai.chat — STREAMING (ADR-0013). The turn runs on a remote AI Provider (desktop) over the
  // Bridge; RN forwards each event back via window.__nomadAiEvent(id, ev). Returns an async iterator
  // of text chunks, mirroring desktop fg/ai.ts. The modifyDrive consent prompt is handled NATIVELY
  // by the RN app (that's where the human is), so the page never sees a 'prompt' event.
  var aiStreams = {};
  window.__nomadAiEvent = function(id, ev){
    var s = aiStreams[id]; if (!s) return;
    if (ev.kind === 'chunk') s.push({ value: ev.text, done: false });
    else if (ev.kind === 'tool') { if (s.onTool) { try { s.onTool(ev.event); } catch(e){} } }
    else if (ev.kind === 'done') { delete aiStreams[id]; s.end(); }
    else if (ev.kind === 'error') { delete aiStreams[id]; s.error(new Error((ev && ev.message) || 'AI error')); }
  };
  function aiChat(messages, opts){
    opts = opts || {};
    var id = 'a' + (++seq);
    var queue = [], done = false, err = null, waitResolve = null, waitReject = null;
    function push(item){ if (waitResolve){ var r = waitResolve; waitResolve = waitReject = null; r(item); } else queue.push(item); }
    function end(){ done = true; if (waitResolve){ var r = waitResolve; waitResolve = waitReject = null; r({ value: undefined, done: true }); } }
    function error(e){ if (waitReject){ var r = waitReject; waitResolve = waitReject = null; r(e); } else { err = e; } }
    aiStreams[id] = { push: push, end: end, error: error, onTool: opts.onToolEvent };
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'nomad-ai-chat',
        payload: { id: id, messages: messages, opts: { driveUrl: opts.driveUrl || null, allowWrite: opts.allowWrite, context: opts.context || null } }
      }));
    } catch (e) { delete aiStreams[id]; error(e); }
    var it = {
      next: function(){
        if (queue.length) return Promise.resolve(queue.shift());
        if (err){ var e = err; err = null; return Promise.reject(e); }
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise(function(resolve, reject){ waitResolve = resolve; waitReject = reject; });
      },
      // Consumer stopped early (break out of for-await) → cancel the remote turn.
      'return': function(){
        try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'nomad-ai-cancel', payload: { id: id } })); } catch (e){}
        delete aiStreams[id]; done = true;
        return Promise.resolve({ value: undefined, done: true });
      }
    };
    it[Symbol.asyncIterator] = function(){ return this; };
    return it;
  }

  var fs = function(url){ return driveApi(url); };
  fs.drive = function(url){ return driveApi(url); };
  fs.getInfo = function(url, o){ return rpc('getInfo', url, [o || {}]); };
  fs.entry = function(url, o){ return rpc('entry', url, [o || {}]); };
  fs.stat = function(url, o){ return rpc('stat', url, [o || {}]); };
  fs.get = function(url, o){ return rpc('get', url, [o || {}]); };
  fs.readFile = function(url, o){ return rpc('readFile', url, [o || {}]); };
  fs.list = function(url, o){ return rpc('list', url, [o || {}]); };
  fs.readdir = function(url, o){ return rpc('readdir', url, [o || {}]); };
  fs.query = function(url, o){ return rpc('query', url, [o || {}]); };
  fs.put = function(url, data, o){ return rpc('put', url, [data, o || {}]); };
  fs.writeFile = function(url, data, o){ return rpc('writeFile', url, [data, o || {}]); };
  fs.del = function(url, o){ return rpc('del', url, [o || {}]); };
  fs.isCollaborativeDrive = function(url){ return rpc('isCollaborativeDrive', url, []); };
  fs.listWriters = function(url){ return rpc('listWriters', url, []); };
  fs.mkdir = function(url, o){ return rpc('mkdir', url, [o || {}]); };
  fs.createDrive = function(o){ return rpc('createDrive', null, [o || {}]).then(function(u){ return driveApi(u); }); };
  fs.createCollaborativeDrive = function(o){ return rpc('createCollaborativeDrive', null, [o || {}]).then(function(u){ return driveApi(u); }); };
  fs.beginDraft = function(url){ return rpc('beginDraft', url, []); };
  fs.endDraft = function(url){ return rpc('endDraft', url, []); };
  fs.draftStatus = function(url){ return rpc('draftStatus', url, []); };
  fs.publishDraft = function(url, o){ return rpc('publishDraft', url, [o || {}]); };
  fs.discardDraft = function(url, o){ return rpc('discardDraft', url, [o || {}]); };
  fs.setDraftPreview = function(url, on){ return rpc('setDraftPreview', url, [on]); };
  fs.watch = noopStream;
  fs.watchDraft = noopStream;
  // nomad.parseUrl — pure hyper:// URL parser (no RPC). Keep in sync with desktop's copy in
  // app/bg/web-apis/fg.ts. Returns null for non-hyper URLs. key is as-written (hex or z32).
  function parseUrl(url){
    var m = /^hyper:\\/\\/([^/+?#]+)(?:\\+([^/?#]+))?([^?#]*)(\\?[^#]*)?/.exec(String(url || ''));
    if (!m) return null;
    return { url: String(url), origin: 'hyper://' + m[1] + '/', key: m[1], version: m[2] || null, path: m[3] || '/', search: m[4] || '' };
  }
  // nomad.page — this page's own identity. The drive key/origin are HOST-provided (window.__nomadPage
  // is injected by the app for the drive it serves on this WebView); path/url are LIVE getters over
  // location, which is truthful here — pages load from the loopback http gateway (a real origin), so
  // native in-page navigations keep nomad.page.path current without re-injection.
  var page = null;
  if (window.__nomadPage && window.__nomadPage.key) {
    page = {
      key: window.__nomadPage.key,
      origin: 'hyper://' + window.__nomadPage.key + '/',
      version: null,
      get path () { return location.pathname || '/'; },
      get search () { return location.search || ''; },
      get url () { return this.origin + (location.pathname || '/').slice(1) + (location.search || ''); }
    };
  } else if (window.__nomadPage && window.__nomadPage.url) {
    page = parseUrl(window.__nomadPage.url);
  } else {
    page = parseUrl(location.href);
  }
  window.nomad = {
    page: page,
    parseUrl: parseUrl,
    fs: fs,
    ai: {
      chat: aiChat,
      // Mobile has no local runtime; connection testing is a Provider concern.
      testConnection: function(){ return Promise.resolve({ ok: false, error: 'AI runs on your desktop device' }); }
    },
    schemas: {
      validate: function(type, data){ return rpcApi('schemas', 'validate', null, [type, data]); }
    },
    markdown: {
      toHTML: function(md){ return rpcApi('markdown', 'toHTML', null, [md]); }
    }
  };
  // schemas/markdown live on their own api names, so they use a small variant.
  function rpcApi(api, method, url, args){
    return new Promise(function(resolve, reject){
      var id = 'b' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'nomad-rpc',
          payload: { id: id, api: api, method: method, url: url || null, args: args || [] }
        }));
      } catch (e) { delete pending[id]; reject(e); }
    });
  }
  true;
})();`

// On-demand: ask the page for its current HTML (routed back as {type:'source'}).
export const VIEW_SOURCE_JS = `(function(){ try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'source', html: '<!doctype html>\\n' + document.documentElement.outerHTML})); } catch(e){} true; })();`

export interface CreatedMsg {
  reqId: string
  ok: boolean
  url?: string
  key?: string
  type?: DriveType
  ns?: string
  title?: string
  message?: string
}
