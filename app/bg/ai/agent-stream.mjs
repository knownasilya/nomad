// Turn one JSON line from `claude` / `cursor-agent` --output-format stream-json
// into text the chat UI should append. Snapshots that repeat earlier text only
// contribute the new suffix, so a final "result" line does not print the answer twice.

export function createAgentReducer() {
  let acc = '';
  return function reduce(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('{')) return [];
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return [];
    }
    const events = [];
    const blocks = Array.isArray(msg?.message?.content) ? msg.message.content : [];
    for (const block of blocks) {
      if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name) {
        events.push({ type: 'tool', name: block.name });
      }
    }
    const pieces = [];
    const delta = msg?.event?.delta;
    if (
      msg?.type === 'stream_event' &&
      delta?.type === 'text_delta' &&
      typeof delta.text === 'string'
    ) {
      pieces.push(delta.text);
    }
    if (typeof msg?.text === 'string') pieces.push(msg.text);
    // Skip text blocks on API error messages (e.g. auth failures): the `result` line
    // that follows has `is_error: true` and produces a proper `error` event instead.
    if (!msg.is_api_error_message) {
      for (const block of blocks) {
        if (block?.type === 'text' && typeof block.text === 'string') pieces.push(block.text);
      }
    }
    if (msg?.type === 'result' && typeof msg.result === 'string') {
      if (msg.is_error) {
        events.push({ type: 'error', text: msg.result });
        return events;
      }
      pieces.push(msg.result);
    }
    for (const piece of pieces) events.push(...suffix(piece));
    return events;
  };

  function suffix(text) {
    if (!text) return [];
    if (text.startsWith(acc)) {
      const extra = text.slice(acc.length);
      acc = text;
      return extra ? [{ type: 'text', text: extra }] : [];
    }
    acc += text;
    return [{ type: 'text', text }];
  }
}

export function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// The images in a chat as Anthropic image blocks. `claude -p` reads them from one
// stream-json user message on stdin; a photo saved to a file would need a Read tool,
// and Claude runs with its tools off.
export function imageBlocks(messages) {
  const blocks = [];
  for (const message of messages || []) {
    if (message?.role === 'system' || !Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      const url = part?.type === 'image_url' ? part.image_url?.url : null;
      if (typeof url !== 'string') continue;
      const data = url.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/);
      if (data) {
        const type = data[1] === 'jpg' ? 'jpeg' : data[1];
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/' + type, data: data[2].replace(/\s/g, '') },
        });
      } else if (/^https?:\/\//i.test(url)) {
        blocks.push({ type: 'image', source: { type: 'url', url } });
      }
    }
  }
  return blocks;
}

// One stream-json user line for `claude --input-format stream-json`: images first, then text.
export function claudeUserLine(prompt, images) {
  const content = [...(images || []), { type: 'text', text: prompt || '' }];
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

// The CLI takes one prompt plus an optional system string. Tool messages stay in
// the transcript so a follow-up turn still sees what search/execute returned.
export function promptFromMessages(messages) {
  const system = [];
  const lines = [];
  for (const message of messages || []) {
    const text = messageText(message?.content);
    const calls = Array.isArray(message?.tool_calls)
      ? message.tool_calls
          .map((call) => `${call?.function?.name || 'tool'} ${call?.function?.arguments || ''}`)
          .join('\n')
      : '';
    const body = [text, calls].filter(Boolean).join('\n');
    if (message?.role === 'system') {
      if (body) system.push(body);
      continue;
    }
    const role =
      message?.role === 'assistant' ? 'Assistant' : message?.role === 'tool' ? 'Tool' : 'User';
    if (body) lines.push(`${role}: ${body}`);
  }
  return { system: system.join('\n\n'), prompt: lines.join('\n\n') };
}

// The `claude` CLI's own model list: the `models` array in its reply to an `initialize` control
// request (stream-json mode). Returns [{ value, label }] — `value` goes to --model as is. An alias
// (value differs from resolvedModel) is labelled with the version it runs today. "default" is
// dropped: an empty model already means the CLI's default.
export function parseClaudeModels(text) {
  for (const raw of String(text || '').split('\n')) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      continue;
    }
    if (msg?.type !== 'control_response') continue;
    const res = msg.response?.response || msg.response || {};
    if (!Array.isArray(res.models)) return [];
    const out = [];
    for (const m of res.models) {
      const value = typeof m?.value === 'string' ? m.value : '';
      if (!value || value === 'default') continue;
      const name = m.displayName || value;
      const label = m.resolvedModel && m.resolvedModel !== value ? `${name} (latest, "${value}")` : name;
      out.push({ value, label });
    }
    return out;
  }
  return [];
}

export function parseCursorModels(text) {
  const ids = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || /^usage:/i.test(line) || /^failed/i.test(line) || line.startsWith('-')) continue;
    try {
      const parsed = JSON.parse(line);
      const list = Array.isArray(parsed) ? parsed : parsed.models || parsed.data;
      if (Array.isArray(list)) {
        for (const item of list) {
          const id = typeof item === 'string' ? item : item?.id || item?.name;
          if (typeof id === 'string' && id) ids.push(id);
        }
        continue;
      }
    } catch {
      /* a plain text catalogue */
    }
    const id = line.split(/\s+—\s+|\s+-\s+/)[0].trim();
    if (/^[A-Za-z0-9_.:[\]=,-]+$/.test(id)) ids.push(id);
  }
  return [...new Set(ids)];
}
