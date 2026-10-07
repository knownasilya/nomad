import { describe, it, expect } from 'vitest'
import { createAgentReducer } from '../../app/bg/ai/agent-stream.mjs'

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
