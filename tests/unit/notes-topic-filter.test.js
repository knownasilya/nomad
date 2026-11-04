// The Notes topic filter (app/userland/notes/js/topic-filter.js): a dropdown, All by default, with
// any number of topics ticked.

import { describe, it, expect } from 'vitest'
import { isTopicOn, toggleTopic, keepKnownTopics, matchesTopics, topicFilterLabel } from '../../app/userland/notes/js/topic-filter.js'

describe('Notes topic filter', () => {
  it('shows every note with nothing ticked', () => {
    expect(matchesTopics([], [])).toBe(true)
    expect(matchesTopics(undefined, [])).toBe(true)
    expect(matchesTopics(['Garden'], [])).toBe(true)
  })

  it('shows the notes with any ticked topic, ignoring case', () => {
    expect(matchesTopics(['Garden'], ['garden', 'Work'])).toBe(true)
    expect(matchesTopics(['Work', 'Home'], ['Garden', 'work'])).toBe(true)
    expect(matchesTopics(['Reading'], ['Garden', 'Work'])).toBe(false)
    expect(matchesTopics([], ['Garden'])).toBe(false)
    expect(matchesTopics(undefined, ['Garden'])).toBe(false)
  })

  it('ticks and unticks one topic at a time', () => {
    let sel = toggleTopic([], 'Garden')
    expect(sel).toEqual(['Garden'])
    sel = toggleTopic(sel, 'Work')
    expect(sel).toEqual(['Garden', 'Work'])
    expect(isTopicOn(sel, 'WORK')).toBe(true)
    sel = toggleTopic(sel, 'garden')
    expect(sel).toEqual(['Work'])
  })

  it('drops a ticked topic no note has any more', () => {
    const known = [{ topic: 'Garden', count: 3 }, { topic: 'Work', count: 1 }]
    expect(keepKnownTopics(['garden', 'Reading', 'Work'], known)).toEqual(['garden', 'Work'])
  })

  it('names what it shows', () => {
    expect(topicFilterLabel([])).toBe('All topics')
    expect(topicFilterLabel(['Garden'])).toBe('Garden')
    expect(topicFilterLabel(['Garden', 'Work'])).toBe('Garden, Work')
    expect(topicFilterLabel(['Garden', 'Work', 'Home'])).toBe('Garden + 2 more')
  })
})
