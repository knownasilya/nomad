import errors from 'beaker-error-constants';
import aiManifest from '../manifests/external/ai';
import { fromEventStream } from './event-target';
import { streamToAsyncIterator } from './ai-stream';

const RPC_OPTS = { timeout: false, errors };

export function setup(rpc) {
  const aiRPC = rpc.importAPI('ai', aiManifest, RPC_OPTS);

  return {
    ai: {
      // opts (optional): { driveUrl, allowWrite, context, usePageTools, pageToolsWcId, model,
      //                    think, onToolEvent, onReasoning }
      //   driveUrl / allowWrite / context are forwarded to bg (see bg/ai.ts).
      //   usePageTools / pageToolsWcId control WebMCP page tools (document.modelContext).
      //   model overrides the resolved model; think:false asks the runtime to skip reasoning.
      //   onToolEvent(e) fires for each tool the agent runs that reports state —
      //     writeDriveFile (e.path / e.priorContent for undo) and page_* tools.
      //   onReasoning(text) fires for each reasoning-stream chunk (only when think !== false and
      //     the model emits one); the visible answer still comes back as iterator chunks.
      chat(messages, opts: any = {}) {
        const eventTarget = fromEventStream(
          aiRPC.chat(messages, {
            driveUrl: opts.driveUrl,
            allowWrite: opts.allowWrite,
            context: opts.context,
            usePageTools: opts.usePageTools,
            pageToolsWcId: opts.pageToolsWcId,
            model: opts.model,
            think: opts.think,
            effort: opts.effort,
          })
        );
        if (typeof opts.onToolEvent === 'function') {
          eventTarget.addEventListener('tool', (e) => opts.onToolEvent(e));
        }
        if (typeof opts.onReasoning === 'function') {
          eventTarget.addEventListener('reasoning', (e) => opts.onReasoning(e.text));
        }
        return streamToAsyncIterator(eventTarget);
      },
      testConnection(baseUrl) {
        return aiRPC.testConnection(baseUrl);
      },
      listModels() {
        return aiRPC.listModels();
      },
      listTools(opts: any = {}) {
        return aiRPC.listTools({ driveUrl: opts.driveUrl, allowWrite: opts.allowWrite });
      },
      modelInfo(model) {
        return aiRPC.modelInfo(model);
      },
    },
  };
}

