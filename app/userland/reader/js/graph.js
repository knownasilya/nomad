// The Reader canvas: saved articles gathered around their topics, and feed posts around their feed.
// No DOM and no imports, so nomad://reader loads it as it is (js/main.js imports it when the canvas
// first shows) and the phone's canvas page bundles it (app-stdlib/js/graph/phone.js). The canvas
// itself is app-stdlib's (app-stdlib/js/graph/).
//
// Node ids say what each node is:
//   topic:<topic, lowercased>   a topic hub (ADR-0033), linked to every article that has the topic
//   article:<id>                a saved article, linked to each of its topics
//   feed:<url>                  a followed feed's hub, linked to its posts
//   post:<url>                  a feed post, linked to its feed, and to a topic hub when one of its
//                               tags is a topic the user's articles have
// An article with no topic yet floats free. Read articles and posts are drawn faint (muted).

export const MAX_POSTS_PER_FEED = 30; // the newest; a big feed would bury the topics

// data: { articles, posts, read } as nomad://reader and the phone keep them: articles from the
// Reader's state, posts aggregated from the feeds ({ url, title, tags, feedUrl, feedTitle,
// createdAt }), read the URLs of posts marked read.
export function readerGraph({ articles = [], posts = [], read = [] } = {}) {
  const readSet = read instanceof Set ? read : new Set(read || []);
  const nodes = [];
  const links = [];
  const index = new Map();
  const add = (node) => {
    index.set(node.id, nodes.length);
    nodes.push({ degree: 0, ...node });
    return nodes.length - 1;
  };
  const link = (source, target, distance) => {
    links.push({ source, target, distance });
    nodes[source].degree++;
    nodes[target].degree++;
  };
  const topicHub = (topic) => {
    const id = 'topic:' + String(topic).toLowerCase();
    return index.has(id) ? index.get(id) : add({ id, title: topic, kind: 'topic', hub: true, charge: 2.5 });
  };

  for (const a of articles) {
    if (!a || !a.id) continue;
    const i = add({ id: 'article:' + a.id, title: a.title || a.site || a.url || 'Untitled', kind: 'article', muted: !!a.readAt });
    const seen = new Set();
    for (const t of a.topics || []) {
      const key = String(t).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      link(i, topicHub(t), 55);
    }
  }

  const byFeed = new Map();
  for (const p of posts) {
    if (!p || !p.url || !p.feedUrl) continue;
    if (!byFeed.has(p.feedUrl)) byFeed.set(p.feedUrl, []);
    byFeed.get(p.feedUrl).push(p);
  }
  for (const [feedUrl, list] of byFeed) {
    const newest = list.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, MAX_POSTS_PER_FEED);
    const hub = add({ id: 'feed:' + feedUrl, title: list[0].feedTitle || feedUrl, kind: 'feed', hub: true, charge: 2.5 });
    for (const p of newest) {
      if (index.has('post:' + p.url)) continue;
      const i = add({ id: 'post:' + p.url, title: p.title || p.url, kind: 'post', muted: readSet.has(p.url) });
      link(i, hub, 55);
      // A tag that is one of the user's topics joins the post to that topic's cluster too.
      const seen = new Set();
      for (const tag of p.tags || []) {
        const key = 'topic:' + String(tag).toLowerCase();
        if (seen.has(key) || !index.has(key)) continue;
        seen.add(key);
        link(i, index.get(key), 90);
      }
    }
  }
  return { nodes, links };
}

// What the search matches for each node: the title, plus an article's site, excerpt and topics.
export function readerTexts({ articles = [], posts = [] } = {}) {
  const out = new Map();
  for (const a of articles) {
    if (!a || !a.id) continue;
    out.set('article:' + a.id, [a.title, a.site, a.excerpt, ...(a.topics || [])].filter(Boolean).join(' ').toLowerCase());
    for (const t of a.topics || []) out.set('topic:' + String(t).toLowerCase(), String(t).toLowerCase());
  }
  for (const p of posts) {
    if (!p || !p.url) continue;
    out.set('post:' + p.url, [p.title, p.summary, p.feedTitle, ...(p.tags || [])].filter(Boolean).join(' ').toLowerCase());
    if (p.feedUrl) out.set('feed:' + p.feedUrl, String(p.feedTitle || '').toLowerCase());
  }
  return out;
}
