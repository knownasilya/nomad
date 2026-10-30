// Turn one JSON line from `claude` / `cursor-agent` --output-format stream-json
// into text the chat UI should append. Both CLIs say each reply more than once:
// - claude streams text_delta events, sends each whole block again as an
//   `assistant` line, and sends the last message again as `result`.
// - cursor sends `assistant` lines that are deltas, then one `assistant` line with
//   the whole segment (the text up to a tool call), and at the end every segment
//   again as `result`.
// Only the first copy goes to the chat. Only `assistant` lines are reply text:
// cursor also echoes the prompt as a `user` line and streams its reasoning as
// `thinking` lines.

export function createAgentReducer() {
  let reply = ''; // all the text sent so far
  // The text sent in the current claude block, or since cursor's last tool call or
  // whole segment.
  let segment = '';
  let deltas = false; // claude: text comes as stream events, so `assistant` lines are whole blocks
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
    const send = (text) => {
      if (!text) return;
      reply += text;
      segment += text;
      events.push({ type: 'text', text });
    };

    if (msg?.type === 'stream_event') {
      if (msg.event?.type === 'content_block_start') segment = '';
      const delta = msg.event?.delta;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        deltas = true;
        send(delta.text);
      }
      return events;
    }

    if (msg?.type === 'result') {
      if (typeof msg.result !== 'string') return events;
      if (msg.is_error) return [{ type: 'error', text: msg.result }];
      // A repeat of the last message (claude) or of the whole reply (cursor). Only
      // text that did not stream before is new.
      if (msg.result.startsWith(reply)) send(msg.result.slice(reply.length));
      return events;
    }

    if (msg?.type === 'tool_call') {
      segment = '';
      return events;
    }

    // claude: the results of the tools it called come back as a `user` line, one
    // tool_result block per call, named by the tool_use block's id.
    if (msg?.type === 'user') {
      const results = Array.isArray(msg.message?.content) ? msg.message.content : [];
      for (const block of results) {
        if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        events.push({ type: 'toolEnd', id: block.tool_use_id, error: !!block.is_error });
      }
      return events;
    }

    if (msg?.type !== 'assistant') return events;
    const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
    for (const block of blocks) {
      if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name) {
        const id = typeof block.id === 'string' && block.id ? block.id : undefined;
        events.push({ type: 'tool', id, name: block.name, input: block.input });
        segment = '';
      }
      if (block?.type !== 'text' || typeof block.text !== 'string') continue;
      // Skip text blocks on API error messages (e.g. auth failures): the `result` line
      // that follows has `is_error: true` and produces a proper `error` event instead.
      if (msg.is_api_error_message) continue;
      if (deltas) {
        // claude: the whole block, which already streamed. Send only what did not.
        if (block.text.startsWith(segment)) send(block.text.slice(segment.length));
      } else if (segment && block.text === segment) {
        // cursor: the whole segment again.
        segment = '';
      } else {
        send(block.text);
      }
    }
    return events;
  };
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
      const label =
        m.resolvedModel && m.resolvedModel !== value ? `${name} (latest, "${value}")` : name;
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
