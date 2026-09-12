// WebMCP bridge (bg side).
//
// A page registers tools with `document.modelContext.registerTool(...)` (polyfilled by
// app/fg/webview-preload/model-context.js). The preload publishes the tool descriptors here
// and holds a `readable` stream we push invoke requests onto; results come back on
// `resolveInvocation`. bg/ai.ts merges the descriptors into a chat turn's tool list
// (namespaced `page_*`) and calls `invokePageTool()` to run one.
//
// State is keyed by webContents id. Tools + pending invokes are dropped when the wc is
// destroyed or navigates its main frame (SPA in-place navigations are kept).
import EventEmitter from 'events';
import emitStream from 'emit-stream';
import * as logLib from '../../logger';
import { sanitizeToolDescriptors, ToolDescriptor } from './webmcp-schema';
import { createInvokeRegistry } from './webmcp-invoke';

const logger = logLib.category('webmcp');

// Traces always land in the log file (query via nomad://library/logs or `nomad.logger`).
// Set NOMAD_WEBMCP_DEBUG=1 to also mirror them to the terminal.
const DEBUG = !!process.env.NOMAD_WEBMCP_DEBUG;
export function trace(msg: string, meta?: any) {
  logger.debug(msg, meta || {});
  if (DEBUG) console.log('[webmcp]', msg, meta ? JSON.stringify(meta) : '');
}

type WcEntry = { origin: string; url: string; tools: ToolDescriptor[] };
type InvokeChannel = { emitter: any; stream: any };
export type InvokeLogEntry = {
  id: number;
  ts: number;
  wcId: number;
  name: string;
  args: any;
  source: string; // 'agent' | 'devtools' | 'console' | …
  ok?: boolean;
  result?: any;
  error?: string;
  ms?: number;
};

const toolsByWc = new Map<number, WcEntry>();
const channelsByWc = new Map<number, InvokeChannel>();
const wiredWcs = new Set<number>();
const invokes = createInvokeRegistry();

// Observability for the WebMCP inspector (nomad://webmcp). `events` emits:
//   'change'          — the tool set for some wc changed
//   'invoke' (entry)  — a tool call started
//   'result' (entry)  — a tool call settled
export const events = new EventEmitter();
events.setMaxListeners(0);
const INVOKE_LOG_CAP = 200;
const invokeLog: InvokeLogEntry[] = [];
let invokeSeq = 0;

function pushLog(entry: InvokeLogEntry) {
  invokeLog.push(entry);
  if (invokeLog.length > INVOKE_LOG_CAP) invokeLog.shift();
}

function originOf(url: string): string {
  try {
    if (url.startsWith('hyper://')) {
      const m = /^hyper:\/\/([^/]+)/.exec(url);
      return m ? `hyper://${m[1]}/` : url;
    }
    return new URL(url).origin;
  } catch {
    return url || 'unknown';
  }
}

function cleanupWc(wcId: number) {
  const had = toolsByWc.has(wcId) || channelsByWc.has(wcId);
  if (had) trace('cleanupWc', { wc: wcId });
  toolsByWc.delete(wcId);
  const channel = channelsByWc.get(wcId);
  if (channel) {
    try {
      channel.stream.end();
    } catch {
      /* already gone */
    }
    channelsByWc.delete(wcId);
  }
  invokes.rejectForWc(wcId, 'The page navigated or closed before the tool returned');
  if (had) events.emit('change');
}

function wireWc(wc: any) {
  if (!wc || wiredWcs.has(wc.id)) return;
  const wcId = wc.id;
  wiredWcs.add(wcId);
  wc.on(
    'did-start-navigation',
    (_e: any, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (isMainFrame && !isInPlace) cleanupWc(wcId);
    }
  );
  wc.on('destroyed', () => {
    cleanupWc(wcId);
    wiredWcs.delete(wcId);
  });
}

export default {
  // renderer → bg: replace the page's published tool set.
  async publishTools(list: any) {
    const wc = this.sender;
    if (!wc || (wc.isDestroyed && wc.isDestroyed())) return;
    wireWc(wc);
    const url = wc.getURL();
    const tools = sanitizeToolDescriptors(list);
    toolsByWc.set(wc.id, { origin: originOf(url), url, tools });
    trace('publishTools', {
      wc: wc.id,
      origin: originOf(url),
      tools: tools.map((t) => t.name),
      raw: Array.isArray(list) ? list.length : typeof list,
    });
    events.emit('change');
  },

  // bg → renderer: a stream we push `['invoke', {callId, name, argsJson}]` frames onto.
  openInvokeStream() {
    const wc = this.sender;
    const emitter = new EventEmitter();
    const stream = emitStream(emitter);
    const wcId = wc.id;
    channelsByWc.set(wcId, { emitter, stream });
    stream.on('close', () => {
      if (channelsByWc.get(wcId)?.stream === stream) channelsByWc.delete(wcId);
    });
    wireWc(wc);
    return stream;
  },

  // renderer → bg: settle one invoke. Only the wc that owns the callId (`<wcId>:<seq>`) may
  // settle it, so one page can't forge a result into another page's in-flight tool call.
  async resolveInvocation({ callId, ok, result, error }: any) {
    const wc = this.sender;
    if (!wc || typeof callId !== 'string' || !callId.startsWith(wc.id + ':')) return;
    invokes.resolve(callId, !!ok, result, error);
  },
};

// --- helpers for bg/ai.ts ---

export function getPageToolsForWc(wcId: number): ToolDescriptor[] {
  return toolsByWc.get(wcId)?.tools || [];
}

export function getPageToolsOrigin(wcId: number): string | null {
  return toolsByWc.get(wcId)?.origin || null;
}

// --- introspection for the WebMCP inspector (bg/webmcp-devtools.ts) ---

export function listAll(): Array<{ wcId: number; url: string; origin: string; tools: ToolDescriptor[] }> {
  const out = [];
  for (const [wcId, e] of toolsByWc) {
    if (!e.url || e.url === 'about:blank') continue;
    out.push({ wcId, url: e.url, origin: e.origin, tools: e.tools });
  }
  return out;
}

export function getInvokeLog(): InvokeLogEntry[] {
  return invokeLog.slice();
}

// Run one page-registered tool. Rejects fast if the page has no open channel (reloaded /
// closed), on timeout, or when `signal` aborts. Every call (agent or inspector) is logged
// to `invokeLog` and mirrored on `events` for nomad://webmcp.
export function invokePageTool(
  wcId: number,
  name: string,
  args: any,
  opts: { signal?: any; timeoutMs?: number; source?: string } = {}
): Promise<any> {
  const channel = channelsByWc.get(wcId);
  trace('invokePageTool', { wc: wcId, name, hasChannel: !!channel, source: opts.source });

  const entry: InvokeLogEntry = {
    id: ++invokeSeq,
    ts: Date.now(),
    wcId,
    name,
    args,
    source: opts.source || 'agent',
  };
  pushLog(entry);
  events.emit('invoke', entry);

  const settle = (patch: Partial<InvokeLogEntry>) => {
    Object.assign(entry, patch, { ms: Date.now() - entry.ts });
    events.emit('result', entry);
  };

  if (!channel) {
    const error = 'Page tools are not available (the page has no active channel)';
    settle({ ok: false, error });
    return Promise.reject(new Error(error));
  }

  return invokes.invoke(wcId, name, args, (frame) => channel.emitter.emit(frame[0], frame[1]), opts).then(
    (result) => {
      settle({ ok: true, result });
      return result;
    },
    (err) => {
      settle({ ok: false, error: String((err && err.message) || err) });
      throw err;
    }
  );
}
