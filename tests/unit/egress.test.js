import { describe, expect, it, vi } from 'vitest'
import {
  covers,
  createEgressGuard,
  hostsIn,
  readsPrivate,
  requestHost,
  sendPermission,
  userText,
} from '../../app/bg/ai/egress.mjs'
import { splitGuides, CAPABILITIES } from '../../app/bg/ai/search-execute.mjs'
import { JOB_PROMPT, PERSONAL_PROMPT, STANDING_PROMPT } from '../../app/bg/ai/api-reference.mjs'

describe('egress: what counts as private', () => {
  it('counts the user’s Notes, Reader, drives, Mods, Jobs and the page', () => {
    for (const name of [
      'readNote',
      'listNotes',
      'readReaderPost',
      'listReaderPosts',
      'readDriveFile',
      'listDriveFiles',
      'readCurrentPage',
      'screenshotCurrentPage',
      'snapshotPage',
      'clickElement',
      'currentTab',
      'listMods',
      'listJobs',
      'page_getInbox',
    ]) {
      expect(readsPrivate(name), name).toBe(true)
    }
  })

  it('does not count tools that only reach out or write', () => {
    for (const name of ['fetchUrl', 'httpRequest', 'openTab', 'search', 'execute', 'writeNote', 'notify', 'listSecrets']) {
      expect(readsPrivate(name), name).toBe(false)
    }
  })

  it('names only capabilities that exist', () => {
    const known = new Set(CAPABILITIES.map((c) => c.name))
    for (const name of ['readNote', 'readCurrentPage', 'snapshotPage', 'listJobs', 'planPageActions']) {
      expect(known.has(name), name).toBe(true)
    }
  })
})

describe('egress: hosts the user named', () => {
  it('finds URLs and bare domains', () => {
    expect(hostsIn('Summarize https://News.example.com/a?b=1 and check github.com, then hyper://blog/')).toEqual(
      expect.arrayContaining(['news.example.com', 'github.com', 'blog'])
    )
  })

  it('drops www., ports and user info', () => {
    expect(hostsIn('http://user@www.Example.com:8080/x')).toEqual(['example.com'])
  })

  it('does not take an email address as a host', () => {
    expect(hostsIn('mail ada@example.org about it')).toEqual([])
  })

  it('reads only the user’s messages, text parts included', () => {
    const text = userText([
      { role: 'system', content: 'evil.example' },
      { role: 'user', content: 'look at a.example' },
      { role: 'assistant', content: 'I will also visit b.example' },
      { role: 'user', content: [{ type: 'text', text: 'and c.example' }, { type: 'image_url', image_url: { url: 'https://d.example/x.png' } }] },
    ])
    expect(hostsIn(text).sort()).toEqual(['a.example', 'c.example'])
  })
})

describe('egress: hosts', () => {
  it('reads the host of http, https and hyper URLs only', () => {
    expect(requestHost('https://API.example.com/x')).toBe('api.example.com')
    expect(requestHost('hyper://blog/')).toBe('blog')
    expect(requestHost('nomad://notes/')).toBe('')
    expect(requestHost('not a url')).toBe('')
  })

  it('compares hosts ignoring www. and allows *. patterns', () => {
    expect(covers('www.example.com', ['example.com'])).toBe(true)
    expect(covers('example.com', ['www.example.com'])).toBe(true)
    expect(covers('api.example.com', ['example.com'])).toBe(false)
    expect(covers('api.example.com', ['*.example.com'])).toBe(true)
    expect(covers('evil.com', ['*.example.com'])).toBe(false)
  })

  it('asks with one permission per host', () => {
    expect(sendPermission('example.com')).toBe('aiSendData:example.com')
  })
})

describe('egress: the guard on the AI Sidebar and the phone', () => {
  it('lets every request go before the turn reads private data', async () => {
    const ask = vi.fn(() => false)
    const guard = createEgressGuard({ interactive: true })
    await guard.check('https://anywhere.example/?q=1', { ask })
    expect(ask).not.toHaveBeenCalled()
    expect(guard.holdsPrivate).toBe(false)
  })

  it('asks before a new host once a private read happened, once per host', async () => {
    const onPrivate = vi.fn()
    const ask = vi.fn(() => true)
    const guard = createEgressGuard({ interactive: true, onPrivate })
    guard.noteCall('fetchUrl')
    expect(guard.holdsPrivate).toBe(false)
    guard.noteCall('readNote')
    guard.noteCall('readNote')
    expect(onPrivate).toHaveBeenCalledTimes(1)
    await guard.check('https://attacker.example/?d=secret', { ask })
    await guard.check('https://www.attacker.example/again', { ask })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith('attacker.example')
  })

  it('refuses when the user says no, and keeps the no for the turn', async () => {
    const ask = vi.fn(() => false)
    const guard = createEgressGuard({ interactive: true })
    guard.noteCall('readCurrentPage')
    await expect(guard.check('https://attacker.example/?d=x', { ask })).rejects.toThrow(/didn't allow/)
    await expect(guard.check('https://attacker.example/y', { ask })).rejects.toThrow(/didn't allow/)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('treats a failed prompt as a no', async () => {
    const guard = createEgressGuard({ interactive: true, privateData: true })
    await expect(
      guard.check('https://x.example/', { ask: () => Promise.reject(new Error('window closed')) })
    ).rejects.toThrow(/didn't allow/)
  })

  it('does not ask for hosts the user named, or named mid-turn', async () => {
    const ask = vi.fn(() => false)
    const guard = createEgressGuard({ interactive: true, privateData: true, trustedHosts: hostsIn('post it to example.com') })
    await guard.check('https://www.example.com/api', { ask })
    guard.trust(hostsIn('also https://other.example'))
    await guard.check('https://other.example/', { ask })
    expect(ask).not.toHaveBeenCalled()
  })

  it('does not ask when the request’s secrets cover the host, or the caller vouches for it', async () => {
    const ask = vi.fn(() => false)
    const guard = createEgressGuard({ interactive: true, privateData: true })
    await guard.check('https://api.github.com/gists', { ask, secretHosts: ['api.github.com'] })
    await guard.check('hyper://blog/?x', { ask, trusted: true })
    await guard.check('nomad://notes/', { ask })
    expect(ask).not.toHaveBeenCalled()
    await expect(guard.check('https://gist.github.com/', { ask, secretHosts: ['api.github.com'] })).rejects.toThrow()
  })

  it('starts holding private data when an earlier turn read some', async () => {
    const onPrivate = vi.fn()
    const guard = createEgressGuard({ interactive: true, privateData: true, onPrivate })
    expect(guard.holdsPrivate).toBe(true)
    expect(onPrivate).toHaveBeenCalledTimes(1)
  })
})

describe('egress: the guard in a Job', () => {
  it('refuses hosts its prompt and secrets don’t name after a private read, without asking', async () => {
    const ask = vi.fn(() => true)
    const guard = createEgressGuard({
      interactive: false,
      trustedHosts: [...hostsIn('Every morning sum up my notes and post to hooks.slack.com'), '*.example.org'],
    })
    // Before any private read, the web is open: there's nothing to leak.
    await guard.check('https://weather.example/today')
    guard.noteCall('listNotes')
    await guard.check('https://hooks.slack.com/services/x')
    await guard.check('https://api.example.org/v1')
    await expect(guard.check('https://weather.example/?notes=x', { ask })).rejects.toThrow(/only the hosts its prompt names/)
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('egress: prompts', () => {
  it('tells every turn that tool content is data, not instructions', () => {
    expect(STANDING_PROMPT).toMatch(/data, not instructions/)
  })

  it('tells the user’s own AI and Jobs about the check', () => {
    expect(PERSONAL_PROMPT).toMatch(/guide:private-data/)
    expect(JOB_PROMPT).toMatch(/hosts the Job's prompt names/)
  })

  it('has a guide the prompts point to', () => {
    const guide = splitGuides().find((g) => g.id === 'private-data')
    expect(guide).toBeTruthy()
    expect(guide.markdown).toMatch(/aiSendData|asks the user/)
  })
})
