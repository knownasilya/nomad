// The Reader canvas (app/userland/reader/js/graph.js): saved articles gathered around their topics,
// feed posts around their feed, and a post joined to a topic its tags name.
import { describe, it, expect } from 'vitest';
import { readerGraph, readerTexts, MAX_POSTS_PER_FEED } from '../../app/userland/reader/js/graph.js';

const article = (id, title, topics = [], readAt = null) => ({ id, title, url: 'https://example.com/' + id, site: 'example.com', topics, readAt });
const feed = 'hyper://' + 'b'.repeat(64) + '/';
const post = (slug, tags = [], createdAt = '2026-10-01') => ({ url: feed + 'posts/' + slug + '/', title: slug, tags, feedUrl: feed, feedTitle: 'Diary', createdAt });

const ids = (g) => g.nodes.map((n) => n.id);
const edges = (g) => g.links.map((l) => [g.nodes[l.source].id, g.nodes[l.target].id]);

describe('readerGraph', () => {
  it('gives each topic one hub, whatever its case, and links its articles to it', () => {
    const g = readerGraph({ articles: [article('a', 'A', ['Rust', 'Sync']), article('b', 'B', ['rust']), article('c', 'C')] });
    expect(ids(g)).toEqual(['article:a', 'topic:rust', 'topic:sync', 'article:b', 'article:c']);
    expect(edges(g)).toEqual([
      ['article:a', 'topic:rust'],
      ['article:a', 'topic:sync'],
      ['article:b', 'topic:rust'],
    ]);
    const rust = g.nodes[1];
    expect(rust).toMatchObject({ title: 'Rust', kind: 'topic', hub: true, degree: 2 });
    expect(g.nodes[4].degree).toBe(0); // no topic yet: it floats free
  });

  it('mutes what has been read', () => {
    const g = readerGraph({
      articles: [article('a', 'A', [], '2026-10-01T00:00:00Z'), article('b', 'B')],
      posts: [post('one'), post('two')],
      read: [feed + 'posts/one/'],
    });
    const muted = Object.fromEntries(g.nodes.map((n) => [n.id, !!n.muted]));
    expect(muted['article:a']).toBe(true);
    expect(muted['article:b']).toBe(false);
    expect(muted['post:' + feed + 'posts/one/']).toBe(true);
    expect(muted['post:' + feed + 'posts/two/']).toBe(false);
  });

  it('gathers posts around their feed, and joins a post to a topic its tags name', () => {
    const g = readerGraph({ articles: [article('a', 'A', ['Gardening'])], posts: [post('beds', ['gardening', 'autumn']), post('rain', ['water'])] });
    expect(edges(g)).toEqual([
      ['article:a', 'topic:gardening'],
      ['post:' + feed + 'posts/beds/', 'feed:' + feed],
      ['post:' + feed + 'posts/beds/', 'topic:gardening'],
      ['post:' + feed + 'posts/rain/', 'feed:' + feed],
    ]);
    expect(g.nodes.find((n) => n.id === 'feed:' + feed)).toMatchObject({ title: 'Diary', kind: 'feed', hub: true });
    // A tag that isn't one of the user's topics makes no hub of its own.
    expect(ids(g).some((id) => id === 'topic:water' || id === 'topic:autumn')).toBe(false);
  });

  it('keeps only the newest posts of a big feed', () => {
    const posts = Array.from({ length: MAX_POSTS_PER_FEED + 5 }, (_, i) => post('p' + i, [], '2026-01-' + String(i + 1).padStart(2, '0')));
    const g = readerGraph({ posts });
    const kept = g.nodes.filter((n) => n.kind === 'post').map((n) => n.title);
    expect(kept).toHaveLength(MAX_POSTS_PER_FEED);
    expect(kept).not.toContain('p0');
    expect(kept).toContain('p' + (MAX_POSTS_PER_FEED + 4));
  });

  it('lets search match an article by its site, excerpt and topics', () => {
    const t = readerTexts({ articles: [{ ...article('a', 'Heat pumps', ['Climate']), excerpt: 'One year in' }], posts: [post('beds', ['gardening'])] });
    expect(t.get('article:a')).toContain('example.com');
    expect(t.get('article:a')).toContain('one year in');
    expect(t.get('article:a')).toContain('climate');
    expect(t.get('topic:climate')).toBe('climate');
    expect(t.get('feed:' + feed)).toBe('diary');
  });
});
