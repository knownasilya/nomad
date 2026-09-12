// Pure helpers shared by bg/model-context.ts and bg/ai.ts for the WebMCP bridge.
// No imports — safe to unit-test in isolation.

const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_TOOLS = 32;
const MAX_DESC = 1024;
const MAX_SCHEMA_BYTES = 16 * 1024;

export type ToolDescriptor = { name: string; description: string; inputSchema: any };

// Clamp a page-supplied tool list to something safe to hand the model: valid names only,
// control chars stripped from descriptions, schemas that round-trip through JSON and stay
// under a size cap, and at most MAX_TOOLS entries.
export function sanitizeToolDescriptors(list: any): ToolDescriptor[] {
  if (!Array.isArray(list)) return [];
  const out: ToolDescriptor[] = [];
  for (const t of list) {
    if (out.length >= MAX_TOOLS) break;
    if (!t || typeof t.name !== 'string' || !TOOL_NAME_RE.test(t.name)) continue;
    let description = typeof t.description === 'string' ? t.description : '';
    description = stripControlChars(description).slice(0, MAX_DESC);
    let inputSchema: any = null;
    if (t.inputSchema && typeof t.inputSchema === 'object') {
      try {
        const json = JSON.stringify(t.inputSchema);
        if (json && byteLength(json) <= MAX_SCHEMA_BYTES) inputSchema = JSON.parse(json);
      } catch {
        /* drop an unserialisable schema, keep the tool */
      }
    }
    out.push({ name: t.name, description, inputSchema });
  }
  return out;
}

// Flatten a WebMCP tool result ({ content: [{ type:'text', text }] }, a bare string, or
// arbitrary JSON) into the plain string the model expects as a tool message.
export function pageToolResultToText(res: any): string {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  if (Array.isArray(res.content)) {
    const text = res.content
      .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n');
    if (text) return res.isError ? `Error: ${text}` : text;
  }
  try {
    return JSON.stringify(res);
  } catch {
    return String(res);
  }
}

// Reduce a page-supplied JSON Schema to the subset OpenAI function-calling accepts. Unknown
// keys (incl. $schema/$ref/$defs) are dropped; a missing/!object schema → an empty object.
export function jsonSchemaToParameters(schema: any): any {
  const EMPTY = { type: 'object', properties: {} };
  const KEEP = new Set([
    'type',
    'required',
    'enum',
    'const',
    'description',
    'anyOf',
    'oneOf',
    'allOf',
    'additionalProperties',
    'default',
    'format',
    'nullable',
    'title',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'pattern',
  ]);
  const clean = (node: any): any => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== 'object') return node;
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'properties' && v && typeof v === 'object') {
        out.properties = {};
        for (const [pk, pv] of Object.entries(v)) out.properties[pk] = clean(pv);
      } else if (k === 'items') {
        out.items = clean(v);
      } else if (KEEP.has(k)) {
        out[k] = clean(v);
      }
    }
    return out;
  };
  if (!schema || typeof schema !== 'object') return EMPTY;
  const result = clean(schema);
  if (!result.type) result.type = 'object';
  if (result.type === 'object' && !result.properties) result.properties = {};
  return result;
}

function stripControlChars(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out += code < 0x20 || code === 0x7f ? ' ' : str[i];
  }
  return out;
}

function byteLength(str: string): number {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(str);
  return new TextEncoder().encode(str).length;
}
