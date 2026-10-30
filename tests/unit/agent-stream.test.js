import { describe, it, expect } from 'vitest'
import { claudeUserLine, createAgentReducer, imageBlocks, parseClaudeModels } from '../../app/bg/ai/agent-stream.mjs'

function collect(lines) {
  const reduce = createAgentReducer()
  return lines.flatMap((line) => reduce(line))
}

describe('createAgentReducer', () => {
  it('emits text from a stream_event text_delta', () => {
    const events = collect([
      JSON.stringify({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'Hello' } } }),
    ])
    expect(events).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('emits text from a result message', () => {
    const events = collect([
      JSON.stringify({ type: 'result', result: 'Done.' }),
    ])
    expect(events).toEqual([{ type: 'text', text: 'Done.' }])
  })

  it('emits an error event for an is_error result', () => {
    const events = collect([
      JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }),
    ])
    expect(events).toEqual([{ type: 'error', text: 'Not logged in · Please run /login' }])
  })

  it('does not emit text after an is_error result', () => {
    const events = collect([
      JSON.stringify({ type: 'result', is_error: true, result: 'oops', text: 'also text' }),
    ])
    expect(events.filter((e) => e.type === 'text')).toEqual([])
  })

  it('does not emit text from an is_api_error_message assistant turn', () => {
    const events = collect([
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
        error: 'authentication_failed',
        is_api_error_message: true,
      }),
    ])
    expect(events.filter((e) => e.type === 'text')).toEqual([])
  })

  it('emits error from result after an is_api_error_message assistant turn', () => {
    const events = collect([
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
        error: 'authentication_failed',
        is_api_error_message: true,
      }),
      JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }),
    ])
    expect(events).toEqual([{ type: 'error', text: 'Not logged in · Please run /login' }])
  })

  it('ignores non-JSON lines', () => {
    expect(collect(['not json', '', '   '])).toEqual([])
  })

  // The line order of a real `claude -p --include-partial-messages` run with one tool call.
  it('sends each claude message once in a turn with a tool call', () => {
    const delta = (text) => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
    const event = (type) => JSON.stringify({ type: 'stream_event', event: { type } })
    const assistant = (block) => JSON.stringify({ type: 'assistant', message: { content: [block] } })
    const events = collect([
      event('message_start'),
      event('content_block_start'),
      delta('Let me check.'),
      assistant({ type: 'text', text: 'Let me check.' }),
      event('content_block_start'),
      assistant({ type: 'tool_use', id: 'toolu_1', name: 'mcp__nomad__execute', input: { code: 'nomad.listNotes()' } }),
      event('message_stop'),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hi' }] } }),
      event('message_start'),
      event('content_block_start'),
      delta('The command printed h'),
      delta('i.'),
      assistant({ type: 'text', text: 'The command printed hi.' }),
      event('message_stop'),
      JSON.stringify({ type: 'result', result: 'The command printed hi.' }),
    ])
    expect(events.filter((e) => e.type === 'tool' || e.type === 'toolEnd')).toEqual([
      { type: 'tool', id: 'toolu_1', name: 'mcp__nomad__execute', input: { code: 'nomad.listNotes()' } },
      { type: 'toolEnd', id: 'toolu_1', error: false },
    ])
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Let me check.The command printed hi.')
  })

  it('ends a claude tool call that failed', () => {
    const events = collect([
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'boom' }] } }),
    ])
    expect(events).toEqual([{ type: 'toolEnd', id: 'toolu_2', error: true }])
  })

  it('takes no tool end from a user line without a tool_result', () => {
    expect(collect([JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } })])).toEqual([])
  })

  it('keeps a claude delta that repeats the text before it', () => {
    const delta = (text) => JSON.stringify({ type: 'stream_event', event: { delta: { type: 'text_delta', text } } })
    expect(collect([delta('ha'), delta('ha')]).map((e) => e.text).join('')).toBe('haha')
  })

  // The line order of a real `cursor-agent -p --stream-partial-output` run with one tool call.
  it('sends each cursor segment once, without the prompt or the thinking', () => {
    const assistant = (text) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
    const events = collect([
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'List the files.' }] } }),
      JSON.stringify({ type: 'thinking', subtype: 'delta', text: 'I will list the files.' }),
      JSON.stringify({ type: 'thinking', subtype: 'completed' }),
      assistant("I'll"),
      assistant(' look.'),
      assistant("I'll look."),
      JSON.stringify({ type: 'tool_call', subtype: 'started' }),
      JSON.stringify({ type: 'tool_call', subtype: 'completed' }),
      assistant('There are'),
      assistant(' 0 files.'),
      assistant('There are 0 files.'),
      JSON.stringify({ type: 'result', subtype: 'success', result: "I'll look.There are 0 files." }),
    ])
    expect(events.map((e) => e.text).join('')).toBe("I'll look.There are 0 files.")
  })
})

describe('imageBlocks', () => {
  it('turns data and http image parts into Anthropic image blocks', () => {
    const blocks = imageBlocks([
      { role: 'system', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'data:image/jpg;base64,QU\nJD' } },
          { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
          { type: 'image_url', image_url: { url: 'file:///etc/passwd' } },
        ],
      },
    ])
    expect(blocks).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
      { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
    ])
  })

  it('returns nothing for a text-only chat', () => {
    expect(imageBlocks([{ role: 'user', content: 'Hello' }])).toEqual([])
  })
})

describe('claudeUserLine', () => {
  it('puts the images before the text in one user message', () => {
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    const line = claudeUserLine('User: Food in the photo.', [image])
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: { role: 'user', content: [image, { type: 'text', text: 'User: Food in the photo.' }] },
    })
  })
})

describe('parseClaudeModels', () => {
  const reply = (models) => JSON.stringify({
    type: 'control_response',
    response: { subtype: 'success', request_id: 'm1', response: { models } }
  })

  it('reads the models from the initialize reply and labels aliases with their version', () => {
    const text = [
      '{"type":"system","subtype":"init"}',
      reply([
        { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
        { value: 'claude-opus-5', resolvedModel: 'claude-opus-5', displayName: 'Opus 5' }
      ])
    ].join('\n')
    expect(parseClaudeModels(text)).toEqual([
      { value: 'opus', label: 'Opus 5.5 (latest, "opus")' },
      { value: 'claude-opus-5', label: 'Opus 5' }
    ])
  })

  it('returns an empty list when there is no reply', () => {
    expect(parseClaudeModels('not json\n{"type":"result"}')).toEqual([])
  })
})
