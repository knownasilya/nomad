import { describe, it, expect } from 'vitest'
import { completionStreamError } from '../../app/bg/ai/stream-error.mjs'

describe('completionStreamError', () => {
  it('reads an MTPLX memory refusal out of an HTTP 200 stream chunk', () => {
    const message = completionStreamError({
      choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
      error: {
        message: 'insufficient memory: the prompt needs about 0.9 GiB more',
        code: 'insufficient_memory',
      },
    })
    expect(message).toMatch(/insufficient memory/)
  })

  it('ignores a normal content chunk', () => {
    expect(completionStreamError({
      choices: [{ delta: { content: 'ok' }, finish_reason: null }],
    })).toBe(null)
  })

  it('still reports finish_reason error when the body has no error object', () => {
    expect(completionStreamError({
      choices: [{ delta: {}, finish_reason: 'error' }],
    })).toMatch(/stopped this reply/)
  })
})
