import { describe, expect, it } from 'vitest'
import {
  addressKind,
  applySecrets,
  captureValues,
  checkValue,
  describeInject,
  hostAllowed,
  makeSecret,
  normalizeHost,
  normalizeHosts,
  normalizeInject,
  normalizeRequest,
  permissionFor,
  pickPath,
  redact,
  redactResult,
  redirectAllowed,
  secretForModel,
} from '../../app/bg/ai/secrets.mjs'
import { guardAddress, nodeTransport, runHttpRequest } from '../../app/bg/ai/http-request.mjs'
import { buildCatalog, JOB_CAPS } from '../../app/bg/ai/search-execute.mjs'
import { askOncePerTurn } from '../../app/bg/ai/vault-tools.mjs'

const TOKEN = 'ghp_abcdefghijklmnop1234'
const github = (over = {}) => ({
  ...makeSecret({ name: 'GITHUB_TOKEN', hosts: ['api.github.com'] }),
  value: TOKEN,
  ...over,
})

describe('secrets: hosts', () => {
  it('tidies hosts and refuses ones that cover too much', () => {
    expect(normalizeHost('https://API.GitHub.com/user?x=1')).toBe('api.github.com')
    expect(normalizeHost('example.com:8443')).toBe('example.com')
    expect(normalizeHost('*.example.com')).toBe('*.example.com')
    expect(normalizeHost('192.168.1.5')).toBe('192.168.1.5')
    expect(() => normalizeHost('*.com')).toThrow(/too much/)
    expect(() => normalizeHost('*')).toThrow()
    expect(() => normalizeHost('exa mple.com')).toThrow()
    expect(normalizeHosts('a.com, b.com a.com')).toEqual(['a.com', 'b.com'])
    expect(() => normalizeHosts([])).toThrow(/at least one host/)
  })

  it('matches exact hosts, and a wildcard only under its domain', () => {
    expect(hostAllowed('api.github.com', ['api.github.com'])).toBe(true)
    expect(hostAllowed('API.GITHUB.COM.', ['api.github.com'])).toBe(true)
    expect(hostAllowed('github.com', ['api.github.com'])).toBe(false)
    expect(hostAllowed('api.github.com.evil.io', ['api.github.com'])).toBe(false)
    expect(hostAllowed('docs.example.com', ['*.example.com'])).toBe(true)
    expect(hostAllowed('example.com', ['*.example.com'])).toBe(false)
    expect(hostAllowed('badexample.com', ['*.example.com'])).toBe(false)
  })

  it('knows loopback and private addresses', () => {
    expect(addressKind('127.0.0.1')).toBe('loopback')
    expect(addressKind('127.8.9.1')).toBe('loopback')
    expect(addressKind('::1')).toBe('loopback')
    expect(addressKind('::ffff:127.0.0.1')).toBe('loopback')
    expect(addressKind('0.0.0.0')).toBe('loopback')
    expect(addressKind('10.0.0.4')).toBe('private')
    expect(addressKind('172.20.1.1')).toBe('private')
    expect(addressKind('192.168.1.5')).toBe('private')
    expect(addressKind('169.254.169.254')).toBe('private')
    expect(addressKind('100.100.1.1')).toBe('private')
    expect(addressKind('fd12::1')).toBe('private')
    expect(addressKind('fe80::1')).toBe('private')
    expect(addressKind('140.82.112.3')).toBe(null)
    expect(addressKind('2606:4700::1111')).toBe(null)
  })

  it('never connects to this computer, and to the local network only when allowed', () => {
    expect(() => guardAddress('127.0.0.1', true)).toThrow(/this computer/)
    expect(() => guardAddress('192.168.1.5', false)).toThrow(/local network/)
    expect(() => guardAddress('192.168.1.5', true)).not.toThrow()
    expect(() => guardAddress('140.82.112.3', false)).not.toThrow()
  })
})

describe('secrets: records', () => {
  it('makes a record with a Bearer header by default, and keeps its name', () => {
    const s = makeSecret({ name: ' github_token ', hosts: 'api.github.com', note: 'Repos' })
    expect(s).toMatchObject({
      name: 'GITHUB_TOKEN',
      hosts: ['api.github.com'],
      note: 'Repos',
      chat: true,
      jobs: [],
      inject: { in: 'header', name: 'Authorization', format: 'Bearer {value}' },
    })
    const changed = makeSecret({ name: 'OTHER', chat: false, jobs: ['job-abc-123', '../x'] }, s)
    expect(changed.name).toBe('GITHUB_TOKEN')
    expect(changed.chat).toBe(false)
    expect(changed.jobs).toEqual(['job-abc-123'])
    expect(changed.hosts).toEqual(['api.github.com'])
    expect(() => makeSecret({ name: '1BAD', hosts: ['a.com'] })).toThrow(/name/)
    expect(() => makeSecret({ name: 'NO_HOSTS' })).toThrow(/host/)
  })

  it('checks where a secret goes', () => {
    expect(normalizeInject({ in: 'header', name: 'X-Api-Key' })).toEqual({ in: 'header', name: 'X-Api-Key', format: '{value}' })
    expect(normalizeInject({ in: 'query', name: 'api_key' })).toEqual({ in: 'query', name: 'api_key' })
    expect(normalizeInject({ in: 'url', name: 'ignored' })).toEqual({ in: 'url' })
    expect(() => normalizeInject({ in: 'header', name: 'Host' })).toThrow()
    expect(() => normalizeInject({ in: 'header', name: 'X', format: 'no placeholder' })).toThrow(/\{value\}/)
    expect(() => normalizeInject({ in: 'cookie' })).toThrow()
    expect(describeInject({ in: 'query', name: 'key' })).toMatch(/\?key=/)
  })

  it('checks a value, and that a URL secret is on its hosts', () => {
    const hook = makeSecret({ name: 'SLACK_HOOK', hosts: ['hooks.slack.com'], inject: { in: 'url' } })
    expect(checkValue(hook, ' https://hooks.slack.com/services/T/B/x ')).toBe('https://hooks.slack.com/services/T/B/x')
    expect(() => checkValue(hook, 'https://evil.io/x')).toThrow(/host/)
    expect(() => checkValue(github(), 'a\nb')).toThrow(/line breaks/)
    expect(() => checkValue(github(), '   ')).toThrow(/empty/)
  })

  it('never gives the model a value', () => {
    const shown = secretForModel({ ...github(), hasValue: true }, true)
    expect(JSON.stringify(shown)).not.toContain(TOKEN)
    expect(shown).toMatchObject({ name: 'GITHUB_TOKEN', hosts: ['api.github.com'], hasValue: true, usable: true })
    expect(permissionFor('GITHUB_TOKEN')).toBe('aiSecretUse:GITHUB_TOKEN')
  })
})

describe('secrets: requests', () => {
  it('puts a header secret in its header, over one the model set', () => {
    const req = normalizeRequest({ url: 'https://api.github.com/user', headers: { authorization: 'Bearer guess' }, secrets: ['GITHUB_TOKEN'] })
    const out = applySecrets(req, [github()])
    expect(out.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(out.url.href).toBe('https://api.github.com/user')
  })

  it('refuses to send a secret to a host it is not for', () => {
    const req = normalizeRequest({ url: 'https://evil.io/steal', secrets: ['GITHUB_TOKEN'] })
    expect(() => applySecrets(req, [github()])).toThrow(/only be sent to api.github.com/)
    const sneaky = normalizeRequest({ url: 'https://api.github.com@evil.io/', secrets: ['GITHUB_TOKEN'] })
    expect(() => applySecrets(sneaky, [github()])).toThrow()
  })

  it('puts query, body and URL secrets where they go', () => {
    const q = { ...makeSecret({ name: 'KEY', hosts: ['api.example.com'], inject: { in: 'query', name: 'api_key' } }), value: 'k-123456' }
    expect(applySecrets(normalizeRequest({ url: 'https://api.example.com/v1?x=1', secrets: ['KEY'] }), [q]).url.href).toBe(
      'https://api.example.com/v1?x=1&api_key=k-123456'
    )

    const refresh = { ...makeSecret({ name: 'REFRESH', hosts: ['oauth2.googleapis.com'], inject: { in: 'body', name: 'refresh_token' } }), value: 'r-abcdef' }
    const form = applySecrets(
      normalizeRequest({ url: 'https://oauth2.googleapis.com/token', method: 'POST', form: { grant_type: 'refresh_token' }, secrets: ['REFRESH'] }),
      [refresh]
    )
    expect(form.body).toBe('grant_type=refresh_token&refresh_token=r-abcdef')
    expect(form.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const json = applySecrets(
      normalizeRequest({ url: 'https://oauth2.googleapis.com/token', method: 'POST', json: { a: 1 }, secrets: ['REFRESH'] }),
      [refresh]
    )
    expect(JSON.parse(json.body)).toEqual({ a: 1, refresh_token: 'r-abcdef' })
    expect(() =>
      applySecrets(normalizeRequest({ url: 'https://oauth2.googleapis.com/token', method: 'POST', body: 'x', secrets: ['REFRESH'] }), [refresh])
    ).toThrow(/json or form/)

    const hook = { ...makeSecret({ name: 'HOOK', hosts: ['hooks.slack.com'], inject: { in: 'url' } }), value: 'https://hooks.slack.com/services/T/B/secretpart' }
    const sent = applySecrets(normalizeRequest({ method: 'POST', json: { text: 'hi' }, secrets: ['HOOK'] }), [hook])
    expect(sent.url.href).toBe(hook.value)
    expect(() => applySecrets(normalizeRequest({ url: 'https://x.io', secrets: ['HOOK'] }), [hook])).toThrow(/Leave out url/)
  })

  it('says when a secret has no value yet', () => {
    expect(() => applySecrets(normalizeRequest({ url: 'https://api.github.com/', secrets: ['GITHUB_TOKEN'] }), [github({ value: null })])).toThrow(
      /no value yet/
    )
  })

  it('checks the model’s arguments', () => {
    expect(() => normalizeRequest({ url: 'https://a.com', method: 'TRACE' })).toThrow(/method/)
    expect(() => normalizeRequest({ url: 'https://a.com', headers: { Host: 'b.com' } })).toThrow(/set for you/)
    expect(() => normalizeRequest({ url: 'https://a.com', headers: { X: 'a\r\nInjected: 1' } })).toThrow()
    expect(() => normalizeRequest({ url: 'https://a.com', body: 'x' })).toThrow(/GET request has no body/)
    expect(() => normalizeRequest({ url: 'https://a.com', method: 'POST', body: 'x', json: {} })).toThrow(/one of/)
    expect(() => normalizeRequest({ url: 'https://a.com', secrets: ['lower'] })).toThrow(/secret name/)
    expect(normalizeRequest({ url: 'https://a.com', secret: 'A_B' }).secrets).toEqual(['A_B'])
  })

  it('follows a redirect that carries secrets only within their hosts', () => {
    expect(redirectAllowed('https://api.github.com/x', [github()])).toBe(true)
    expect(redirectAllowed('https://evil.io/x', [github()])).toBe(false)
    expect(redirectAllowed('https://anywhere.io/x', [])).toBe(true)
  })
})

describe('secrets: redaction and saving', () => {
  const list = [{ name: 'GITHUB_TOKEN', value: TOKEN }]

  it('takes values out of text, in the forms servers echo', () => {
    expect(redact(`token=${TOKEN}`, list)).toBe('token=[secret GITHUB_TOKEN]')
    expect(redact(Buffer.from(TOKEN).toString('base64'), list)).toBe('[secret GITHUB_TOKEN]')
    expect(redact(encodeURIComponent('a b+c/d=e')+'', [{ name: 'X', value: 'a b+c/d=e' }])).toBe('[secret X]')
    expect(redact('short 1 value', [{ name: 'PIN', value: '1' }])).toBe('short 1 value')
    expect(redactResult({ text: TOKEN, imageDataUrl: 'data:x' }, list)).toEqual({ text: '[secret GITHUB_TOKEN]', imageDataUrl: 'data:x' })
    expect(redactResult({ deep: [TOKEN] }, list)).toEqual({ deep: ['[secret GITHUB_TOKEN]'] })
  })

  it('reads values for saveToSecret, and never empties a secret', () => {
    const body = JSON.stringify({ access_token: 'new-token-1', data: { items: [{ key: 'k2' }] } })
    expect(captureValues({ ACCESS: 'access_token', OTHER: 'data.items[0].key' }, { body })).toEqual([
      { name: 'ACCESS', value: 'new-token-1' },
      { name: 'OTHER', value: 'k2' },
    ])
    expect(captureValues({ T: 'header:X-Token' }, { headers: { 'x-token': 'h-1' } })).toEqual([{ name: 'T', value: 'h-1' }])
    expect(() => captureValues({ ACCESS: 'missing' }, { body })).toThrow(/has no missing/)
    expect(() => captureValues({ ACCESS: 'a' }, { body: 'not json' })).toThrow(/isn’t JSON/)
    expect(pickPath({ a: 1 }, '__proto__')).toBeUndefined()
  })
})

describe('httpRequest', () => {
  function fakeTransport(responses) {
    const sent = []
    return {
      sent,
      transport: async (req) => {
        sent.push(req)
        const next = responses.shift()
        return { headers: {}, body: Buffer.from(''), ...next, body: Buffer.from(next.body || '') }
      },
    }
  }

  it('sends the secret, and the model sees only its name', async () => {
    const { sent, transport } = fakeTransport([{ status: 200, headers: { 'content-type': 'application/json' }, body: `{"echo":"Bearer ${TOKEN}"}` }])
    const asked = []
    const res = await runHttpRequest(
      { url: 'https://api.github.com/user', secrets: ['GITHUB_TOKEN'] },
      {
        resolveSecrets: async (names, host) => {
          asked.push([names, host])
          return [github()]
        },
        transport,
      }
    )
    expect(asked).toEqual([[['GITHUB_TOKEN'], 'api.github.com']])
    expect(sent[0].headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.stringify(res)).not.toContain(TOKEN)
    expect(res.body).toBe('{"echo":"Bearer [secret GITHUB_TOKEN]"}')
    expect(res.usedSecrets).toEqual(['GITHUB_TOKEN'])
  })

  it('does not follow a redirect off the secret’s hosts', async () => {
    const { sent, transport } = fakeTransport([
      { status: 302, headers: { location: 'https://evil.io/collect' }, body: '' },
      { status: 200, body: 'should not be reached' },
    ])
    const res = await runHttpRequest(
      { url: 'https://api.github.com/x', secrets: ['GITHUB_TOKEN'] },
      { resolveSecrets: async () => [github()], transport }
    )
    expect(sent.length).toBe(1)
    expect(res.status).toBe(302)
    expect(res.note).toMatch(/Not followed/)
  })

  it('follows a redirect without secrets, and a 303 becomes a GET', async () => {
    const { sent, transport } = fakeTransport([
      { status: 303, headers: { location: '/done' }, body: '' },
      { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' },
    ])
    const res = await runHttpRequest(
      { url: 'https://example.com/form', method: 'POST', form: { a: '1' } },
      { resolveSecrets: async () => [], transport }
    )
    expect(sent[1].method).toBe('GET')
    expect(sent[1].body).toBe(null)
    expect(sent[1].url.href).toBe('https://example.com/done')
    expect(res).toMatchObject({ status: 200, ok: true, body: 'ok', redirects: 1 })
  })

  it('saves a refreshed token into its secret instead of showing it', async () => {
    const { transport } = fakeTransport([
      { status: 200, headers: { 'content-type': 'application/json' }, body: '{"access_token":"ya29.fresh-token","expires_in":3600}' },
    ])
    const saved = []
    const refresh = { ...makeSecret({ name: 'REFRESH', hosts: ['oauth2.googleapis.com'], inject: { in: 'body', name: 'refresh_token' } }), value: 'r-abcdef' }
    const res = await runHttpRequest(
      {
        url: 'https://oauth2.googleapis.com/token',
        method: 'POST',
        form: { grant_type: 'refresh_token' },
        secrets: ['REFRESH'],
        saveToSecret: { ACCESS: 'access_token' },
      },
      {
        resolveSecrets: async () => [refresh],
        saveSecret: async (name, value, host) => saved.push({ name, value, host }),
        transport,
      }
    )
    expect(saved).toEqual([{ name: 'ACCESS', value: 'ya29.fresh-token', host: 'oauth2.googleapis.com' }])
    expect(res.body).toBe('{"access_token":"[secret ACCESS]","expires_in":3600}')
    expect(res.savedSecrets).toEqual(['ACCESS'])
  })

  it('describes a binary body instead of returning it', async () => {
    const { transport } = fakeTransport([{ status: 200, headers: { 'content-type': 'image/png' }, body: 'PNG…' }])
    const res = await runHttpRequest({ url: 'https://example.com/a.png' }, { resolveSecrets: async () => [], transport })
    expect(res.body).toMatch(/image\/png body, \d+ bytes, not shown/)
  })

  it('refuses this computer before connecting', async () => {
    await expect(
      nodeTransport({ url: new URL('http://127.0.0.1:47655/mcp'), method: 'POST', headers: {}, body: '{}', allowPrivate: true, timeoutMs: 1000, maxBytes: 100 })
    ).rejects.toThrow(/this computer/)
    await expect(
      nodeTransport({ url: new URL('http://localhost:47655/mcp'), method: 'GET', headers: {}, body: null, allowPrivate: true, timeoutMs: 1000, maxBytes: 100 })
    ).rejects.toThrow(/this computer/)
  })
})

describe('secrets: which turns get them', () => {
  const names = (cat) => cat.capabilities.map((c) => c.name)

  it('offers listSecrets and httpRequest to the user’s own AI, never a page or another program', () => {
    expect(names(buildCatalog({ personal: true, tab: true, secrets: true }))).toEqual(expect.arrayContaining(['listSecrets', 'httpRequest']))
    expect(names(buildCatalog({ personal: false, secrets: true }))).not.toContain('httpRequest')
    // The loopback MCP's other programs: personal, but no secrets.
    expect(names(buildCatalog({ personal: true, secrets: false }))).not.toContain('httpRequest')
  })

  it('gives a Job httpRequest, and still no writes', () => {
    const job = names(buildCatalog({ personal: true, job: true, secrets: true, allowWrite: false, remote: true }))
    expect(job).toEqual(expect.arrayContaining(['httpRequest', 'listSecrets', 'notify']))
    expect(job).not.toContain('writeNote')
    expect(job).not.toContain('writeDriveFile')
    expect(JOB_CAPS.has('httpRequest')).toBe(true)
  })

  it('asks once a turn per secret', async () => {
    let asks = 0
    const permit = askOncePerTurn(async () => {
      asks++
      return true
    })
    const sender = { getURL: () => 'https://example.com/' }
    await permit('aiSecretUse:GITHUB_TOKEN', sender)
    await permit('aiSecretUse:GITHUB_TOKEN', sender)
    await permit('aiSecretUse:OTHER', sender)
    expect(asks).toBe(2)
  })
})
