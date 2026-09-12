// WebMCP bridge — plumbing between a page's `document.modelContext` (polyfilled in the
// webview preload) and the AI agent loop in bg/ai.ts. NOT a `window.nomad.*` API; it is
// consumed only by app/fg/webview-preload/model-context.js.
export default {
  publishTools: 'promise', // renderer → bg: the page's current tool descriptors
  openInvokeStream: 'readable', // bg → renderer: `['invoke', {callId, name, argsJson}]` frames
  resolveInvocation: 'promise', // renderer → bg: the result of one invoke
};
