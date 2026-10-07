import { describe, it, expect } from 'vitest'
import { normalizeChatMessages } from '../../app/bg/ai/chat-messages.mjs'

const jpeg = 'data:image/jpeg;base64,' + 'a'.repeat(40)
const png = 'data:image/png;base64,' + 'b'.repeat(40)

describe('normalizeChatMessages', () => {
  it('leaves a text message unchanged', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    expect(normalizeChatMessages(messages)).toEqual(messages)
  })

  it('appends one or more images after the text', () => {
    const [message] = normalizeChatMessages([{
      role: 'user',
      content: 'What food is here?',
      images: [jpeg, { url: png }],
    }])
    expect(message.images).toBeUndefined()
    expect(message.content).toEqual([
      { type: 'text', text: 'What food is here?' },
      { type: 'image_url', image_url: { url: jpeg } },
      { type: 'image_url', image_url: { url: png } },
    ])
  })

  it('keeps image_url parts already on the message and appends images after them', () => {
    const [message] = normalizeChatMessages([{
      role: 'user',
      content: [
        { type: 'text', text: 'Compare these.' },
        { type: 'image_url', image_url: { url: jpeg } },
      ],
      images: [png],
    }])
    expect(message.content.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url'])
    expect(message.content[2].image_url.url).toBe(png)
  })

  it('accepts an http url and a data url with whitespace in the payload', () => {
    const [message] = normalizeChatMessages([{
      role: 'user',
      content: '',
      images: ['https://example.com/shelf.jpg', 'data:image/webp;base64,abc def'],
    }])
    expect(message.content).toEqual([
      { type: 'image_url', image_url: { url: 'https://example.com/shelf.jpg' } },
      { type: 'image_url', image_url: { url: 'data:image/webp;base64,abcdef' } },
    ])
  })

  it('rejects a ninth image, a bad type, and an oversized data url', () => {
    const nine = Array.from({ length: 9 }, () => jpeg)
    expect(() => normalizeChatMessages([{ role: 'user', content: 'x', images: nine }]))
      .toThrow(/at most 8/)
    expect(() => normalizeChatMessages([{ role: 'user', content: 'x', images: ['data:image/bmp;base64,aaaa'] }]))
      .toThrow(/png, jpeg, webp, or gif/)
    const huge = 'data:image/jpeg;base64,' + 'a'.repeat(6_000_000)
    expect(() => normalizeChatMessages([{ role: 'user', content: 'x', images: [huge] }]))
      .toThrow(/too large/)
  })
})
