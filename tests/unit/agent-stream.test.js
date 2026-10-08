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
