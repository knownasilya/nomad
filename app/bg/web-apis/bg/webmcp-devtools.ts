// Backend for the WebMCP inspector app (nomad://webmcp).
//
// Reads the live per-tab tool registry from bg/model-context.ts, lets the inspector run a tool
// by hand (logged with source 'devtools'), and streams change/invoke/result events so the panel
// stays live. nomad:// only (internalOnly guard in bg.ts).
import { webContents } from 'electron';
import EventEmitter from 'events';
import emitStream from 'emit-stream';
import * as modelContext from './model-context';
import * as sitedata from '../../dbs/sitedata';

export default {
  async list() {
    // Keep only live webContents. A page can appear more than once (e.g. a thumbnail-capture
    // window loads it too); collapse to one row per origin, preferring the one with tools.
    const alive = modelContext.listAll().filter((r) => {
      try {
        const wc = webContents.fromId(r.wcId);
        return !!wc && !wc.isDestroyed();
      } catch {
        return false;
      }
    });
    const byOrigin = new Map<string, (typeof alive)[number]>();
    for (const r of alive) {
      const cur = byOrigin.get(r.origin);
      if (!cur || r.tools.length > cur.tools.length) byOrigin.set(r.origin, r);
    }

    return Promise.all(
      [...byOrigin.values()].map(async (r) => {
        let title = '';
        try {
          const wc = webContents.fromId(r.wcId);
          title = wc ? wc.getTitle() : '';
        } catch {
          /* wc gone */
        }
        let permission = null; // 1 allow · 0 deny · null unset
        try {
          const v: any = await sitedata.getPermission(r.url, 'webmcpTools:' + r.origin);
          permission = v === 1 || v === 0 ? v : null;
        } catch {
          /* no row */
        }
        return { wcId: r.wcId, url: r.url, origin: r.origin, title, tools: r.tools, permission };
      })
    );
  },

  async invoke(wcId, name, argsJson) {
    let args: any = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch {
        return { ok: false, error: 'Arguments are not valid JSON' };
      }
    }
    const started = Date.now();
    try {
      const result = await modelContext.invokePageTool(wcId, name, args, {
        source: 'devtools',
        timeoutMs: 15000,
      });
      return { ok: true, result, ms: Date.now() - started };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), ms: Date.now() - started };
    }
  },

  async getLog() {
    return modelContext.getInvokeLog();
  },

  watch() {
    const em = new EventEmitter();
    const onChange = () => em.emit('change', {});
    const onInvoke = (entry: any) => em.emit('invoke', entry);
    const onResult = (entry: any) => em.emit('result', entry);
    modelContext.events.on('change', onChange);
    modelContext.events.on('invoke', onInvoke);
    modelContext.events.on('result', onResult);
    const stream = emitStream(em);
    stream.on('close', () => {
      modelContext.events.removeListener('change', onChange);
      modelContext.events.removeListener('invoke', onInvoke);
      modelContext.events.removeListener('result', onResult);
    });
    return stream;
  },
};
