// Bridges <script> blocks inside HTML files to Monaco's TypeScript language
// service so embedded JS gets the same beaker.* + schema autocomplete, hover, and
// signature help as standalone .js files.
//
// Monaco's HTML worker handles embedded JS itself and ignores the TS defaults'
// extra libs, so we register our own completion/hover/signatureHelp providers on
// the `html` language and delegate to the JS worker.
//
// Trick: for each HTML model we maintain a hidden "masked" JS model — a copy of
// the HTML where every character outside a JS <script> block is replaced with a
// space (newlines preserved) and the script contents are kept verbatim. That
// makes offsets/positions map 1:1 between the HTML and JS models, so no
// coordinate translation is needed.

// htmlModelUri -> { jsModel, version, ranges }
const bridged = new Map();

const JS_SCRIPT_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'module',
  'text/babel',
  'text/jsx',
]);

function partsToString(parts) {
  return (parts || []).map((p) => p.text).join('');
}

// Build the masked JS source + the offset ranges of JS script content.
function buildMasked(htmlText) {
  const chars = new Array(htmlText.length);
  for (let i = 0; i < htmlText.length; i++) {
    const c = htmlText[i];
    chars[i] = c === '\n' || c === '\r' ? c : ' ';
  }
  const ranges = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(htmlText))) {
    const attrs = m[1] || '';
    const typeMatch = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    const type = typeMatch ? typeMatch[1].toLowerCase() : '';
    if (type && !JS_SCRIPT_TYPES.has(type)) continue; // skip JSON/templates/etc.
    const content = m[2];
    if (!content) continue;
    const contentStart = m.index + m[0].indexOf('>') + 1;
    for (let i = 0; i < content.length; i++) {
      chars[contentStart + i] = htmlText[contentStart + i];
    }
    ranges.push([contentStart, contentStart + content.length]);
  }
  return { masked: chars.join(''), ranges };
}

// Ensure (and refresh) the hidden JS model mirroring an HTML model. Returns the
// JS model, or null if the model isn't HTML or has no JS scripts.
function ensureJsModel(monaco, htmlModel) {
  if (!htmlModel || htmlModel.isDisposed()) return null;
  if (htmlModel.getLanguageId() !== 'html') return null;
  const key = htmlModel.uri.toString();
  const version = htmlModel.getVersionId();
  let entry = bridged.get(key);
  if (entry && entry.version === version) {
    return entry.ranges.length ? entry.jsModel : null;
  }
  const { masked, ranges } = buildMasked(htmlModel.getValue());
  if (!entry) {
    const jsUri = monaco.Uri.parse(
      `inmemory://embedded/${encodeURIComponent(key)}.js`
    );
    const jsModel =
      monaco.editor.getModel(jsUri) ||
      monaco.editor.createModel(masked, 'javascript', jsUri);
    entry = { jsModel, version, ranges };
    bridged.set(key, entry);
  } else {
    if (!entry.jsModel.isDisposed()) entry.jsModel.setValue(masked);
    entry.version = version;
    entry.ranges = ranges;
  }
  return ranges.length ? entry.jsModel : null;
}

function offsetInScript(monaco, htmlModel, offset) {
  const entry = bridged.get(htmlModel.uri.toString());
  if (!entry) return false;
  return entry.ranges.some(([s, e]) => offset >= s && offset <= e);
}

async function jsClient(monaco, jsModel) {
  const worker = await monaco.languages.typescript.getJavaScriptWorker();
  return worker(jsModel.uri);
}

const KIND_MAP = {
  method: 'Method',
  function: 'Function',
  constructor: 'Constructor',
  field: 'Field',
  variable: 'Variable',
  var: 'Variable',
  let: 'Variable',
  const: 'Constant',
  class: 'Class',
  interface: 'Interface',
  module: 'Module',
  property: 'Property',
  getter: 'Property',
  setter: 'Property',
  enum: 'Enum',
  keyword: 'Keyword',
  parameter: 'Variable',
  type: 'TypeParameter',
  alias: 'TypeParameter',
  primitive: 'Keyword',
};
function completionKind(monaco, tsKind) {
  const name = KIND_MAP[tsKind] || 'Text';
  return monaco.languages.CompletionItemKind[name];
}

export function registerHtmlEmbeddedProviders(monaco) {
  // Completion
  monaco.languages.registerCompletionItemProvider('html', {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position) {
      const jsModel = ensureJsModel(monaco, model);
      if (!jsModel) return;
      const offset = model.getOffsetAt(position);
      if (!offsetInScript(monaco, model, offset)) return;
      const client = await jsClient(monaco, jsModel);
      const info = await client.getCompletionsAtPosition(
        jsModel.uri.toString(),
        offset
      );
      if (!info) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      );
      const uri = jsModel.uri.toString();
      const suggestions = info.entries.map((e) => ({
        label: e.name,
        kind: completionKind(monaco, e.kind),
        insertText: e.name,
        range,
        sortText: e.sortText,
        _uri: uri,
        _offset: offset,
        _name: e.name,
        _source: e.source,
        _data: e.data,
      }));
      return { suggestions };
    },
    async resolveCompletionItem(item) {
      try {
        const client = await jsClient(monaco, {
          uri: monaco.Uri.parse(item._uri),
        });
        const details = await client.getCompletionEntryDetails(
          item._uri,
          item._offset,
          item._name,
          undefined,
          item._source,
          undefined,
          item._data
        );
        if (details) {
          item.detail = partsToString(details.displayParts);
          const doc = partsToString(details.documentation);
          if (doc) item.documentation = { value: doc };
        }
      } catch (e) {
        /* best-effort details */
      }
      return item;
    },
  });

  // Hover
  monaco.languages.registerHoverProvider('html', {
    async provideHover(model, position) {
      const jsModel = ensureJsModel(monaco, model);
      if (!jsModel) return;
      const offset = model.getOffsetAt(position);
      if (!offsetInScript(monaco, model, offset)) return;
      const client = await jsClient(monaco, jsModel);
      const info = await client.getQuickInfoAtPosition(
        jsModel.uri.toString(),
        offset
      );
      if (!info) return;
      const contents = [];
      const decl = partsToString(info.displayParts);
      if (decl) contents.push({ value: '```typescript\n' + decl + '\n```' });
      const doc = partsToString(info.documentation);
      if (doc) contents.push({ value: doc });
      // textSpan offsets map 1:1 to the HTML model.
      const start = model.getPositionAt(info.textSpan.start);
      const end = model.getPositionAt(info.textSpan.start + info.textSpan.length);
      return {
        range: new monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column
        ),
        contents,
      };
    },
  });

  // Signature help
  monaco.languages.registerSignatureHelpProvider('html', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [')'],
    async provideSignatureHelp(model, position) {
      const jsModel = ensureJsModel(monaco, model);
      if (!jsModel) return;
      const offset = model.getOffsetAt(position);
      if (!offsetInScript(monaco, model, offset)) return;
      const client = await jsClient(monaco, jsModel);
      const info = await client.getSignatureHelpItems(
        jsModel.uri.toString(),
        offset,
        undefined
      );
      if (!info) return;
      const signatures = info.items.map((item) => {
        let label = partsToString(item.prefixDisplayParts);
        const params = item.parameters.map((p) => {
          const paramLabel = partsToString(p.displayParts);
          return {
            label: paramLabel,
            documentation: partsToString(p.documentation) || undefined,
          };
        });
        label += params.map((p) => p.label).join(
          partsToString(item.separatorDisplayParts)
        );
        label += partsToString(item.suffixDisplayParts);
        return {
          label,
          documentation: partsToString(item.documentation) || undefined,
          parameters: params,
        };
      });
      return {
        value: {
          signatures,
          activeSignature: info.selectedItemIndex,
          activeParameter: info.argumentIndex,
        },
        dispose() {},
      };
    },
  });

  // Clean up the hidden JS model when its HTML model goes away (covers the
  // editor's resetEditor() which disposes all models).
  monaco.editor.onWillDisposeModel((model) => {
    const key = model.uri.toString();
    const entry = bridged.get(key);
    if (entry) {
      bridged.delete(key);
      if (!entry.jsModel.isDisposed()) entry.jsModel.dispose();
    }
  });
}
