// The AI search tool's drive domain asks the search crawler over HTTP. These run a stub crawler.

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { searchListedDrives } from '../../app/bg/ai/listed-drives.mjs';

let server;
afterEach(() => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve())));

function stubCrawler(handler) {
  return new Promise((resolve) => {
    server = http.createServer(handler).listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

describe('searchListedDrives', () => {
  it('passes the query and topic and returns the results', async () => {
    let seen;
    const endpoint = await stubCrawler((req, res) => {
      seen = req.url;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ results: [{ driveKey: 'a'.repeat(64), title: 'My Blog', score: 3 }] }));
    });
    const results = await searchListedDrives('peer blog', { topic: 'blog', endpoint });
    expect(seen).toBe('/search?q=peer%20blog&topic=blog');
    expect(results.map((r) => r.title)).toEqual(['My Blog']);
  });

  it('returns [] when the crawler answers badly', async () => {
    const endpoint = await stubCrawler((req, res) => {
      res.statusCode = 500;
      res.end('nope');
    });
    expect(await searchListedDrives('x', { endpoint })).toEqual([]);
  });

  it('returns [] when no crawler is running', async () => {
    server = null;
    expect(await searchListedDrives('x', { endpoint: 'http://127.0.0.1:1' })).toEqual([]);
  });
});
