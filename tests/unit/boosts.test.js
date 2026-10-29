import { describe, it, expect } from 'vitest';
import {
  BOOSTS_PREFIX,
  pageHost,
  siteOf,
  normalizeSite,
  matchesSite,
  PRESETS,
  isHideSelector,
  isStableName,
  selectorFor,
  similarSelectorFor,
  newBoostId,
  isBoostId,
  boostPath,
  cleanHideList,
  makeBoost,
  isBoost,
  boostsFor,
  describeBoost,
  hideCss,
  pageCss,
  boostScript,
  codeRev,
  pagePayload,
} from '../../shared/boosts.mjs';

const KEY = 'a'.repeat(64);
const NOW = '2026-10-29T12:00:00.000Z';
const LATER = '2026-10-29T13:00:00.000Z';

const boost = (fields, now = NOW) => makeBoost({ id: newBoostId(), ...fields }, null, now);

describe('boosts: sites', () => {
  it('knows the pages a Boost can change', () => {
    expect(pageHost('https://WWW.Example.com:8080/a?b#c')).toBe('www.example.com');
    expect(pageHost('http://localhost:3000/')).toBe('localhost');
    expect(pageHost(`hyper://${KEY}/index.html`)).toBe(KEY);
    expect(pageHost('hyper://private/notes')).toBe(null);
    expect(pageHost('nomad://library/')).toBe(null);
    expect(pageHost('file:///tmp/x.html')).toBe(null);
    expect(pageHost('not a url')).toBe(null);
  });
  it('gives a new Boost the host without www', () => {
    expect(siteOf('https://www.example.com/x')).toBe('example.com');
    expect(siteOf('https://docs.example.com/x')).toBe('docs.example.com');
    expect(siteOf('nomad://settings/')).toBe(null);
  });
  it('reads a site as the user types it', () => {
    expect(normalizeSite('example.com')).toBe('example.com');
    expect(normalizeSite('  https://www.Example.com/path?q ')).toBe('example.com');
    expect(normalizeSite('*.example.com')).toBe('example.com');
    expect(normalizeSite(`hyper://${KEY}/`)).toBe(KEY);
    expect(normalizeSite('localhost:3000')).toBe('localhost');
    expect(() => normalizeSite('')).toThrow(/needs a site/);
    expect(() => normalizeSite('not a site')).toThrow(/isn’t a site/);
    expect(() => normalizeSite('hyper://private/')).toThrow(/isn’t a site/);
  });
  it('applies to the site and the hosts under it, over any page scheme', () => {
    expect(matchesSite('example.com', 'https://example.com/')).toBe(true);
    expect(matchesSite('example.com', 'http://www.example.com/a')).toBe(true);
    expect(matchesSite('example.com', 'https://docs.example.com/a')).toBe(true);
    expect(matchesSite('example.com', 'https://notexample.com/')).toBe(false);
    expect(matchesSite('example.com', 'https://example.com.evil.org/')).toBe(false);
    expect(matchesSite('docs.example.com', 'https://example.com/')).toBe(false);
    expect(matchesSite(KEY, `hyper://${KEY}/x`)).toBe(true);
    expect(matchesSite('example.com', 'nomad://example.com/')).toBe(false);
  });
});

describe('boosts: selectors', () => {
  it('takes selectors that keep to their own rule', () => {
    expect(isHideSelector('.ad, #sidebar > div:nth-of-type(2)')).toBe(true);
    expect(isHideSelector('a[href*="promo"]')).toBe(true);
    expect(isHideSelector('')).toBe(false);
    expect(isHideSelector('   ')).toBe(false);
    expect(isHideSelector('.x } body { display: none')).toBe(false);
    expect(isHideSelector('.x /* y')).toBe(false);
    expect(isHideSelector('x'.repeat(1001))).toBe(false);
  });
  it('trusts names that last, and not generated or state ones', () => {
    for (const ok of ['sidebar', 'site-header', 'nav__item', 'MuiButton-root', 'col-2', 'h1', 'top_bar']) {
      expect(isStableName(ok), ok).toBe(true);
    }
    for (const bad of [
      'css-1x2y3z',
      'sc-bdVaJa',
      'jsx-2938471',
      'Header_title__3xYz9',
      'post-12345',
      'a1b2c3',
      'is-active',
      'active',
      'open',
      ':r1:',
      '1abc',
      'x'.repeat(41),
    ]) {
      expect(isStableName(bad), bad).toBe(false);
    }
  });

  // A tiny element tree: el(tag, { id, cls }, children)
  function el(tag, { id = '', cls = [] } = {}, children = []) {
    const node = {
      tagName: tag.toUpperCase(),
      id,
      classList: Object.assign([...cls], { contains: (c) => cls.includes(c) }),
      parentElement: null,
      children,
    };
    for (const c of children) c.parentElement = node;
    return node;
  }
  // Counts with a stub: a map of selector -> count, default 2 (not unique).
  const counter = (counts) => (sel) => counts[sel] ?? 2;

  it('anchors on a stable unique id', () => {
    const target = el('div', { cls: ['promo'] });
    const main = el('main', { id: 'content' }, [target]);
    el('body', {}, [main]);
    expect(selectorFor(target, counter({ '#content': 1 }))).toBe('#content > div.promo');
    // Unique by its own classes: no need to climb.
    expect(selectorFor(target, counter({ 'div.promo': 1 }))).toBe('div.promo');
  });
  it('tells same-tag siblings apart by position', () => {
    const a = el('li', { cls: ['item'] });
    const b = el('li', { cls: ['item'] });
    const ul = el('ul', { cls: ['list'] }, [a, b]);
    el('body', {}, [ul]);
    expect(selectorFor(b, counter({ 'ul.list > li.item:nth-of-type(2)': 1 }))).toBe(
      'ul.list > li.item:nth-of-type(2)'
    );
  });
  it('skips generated ids and classes', () => {
    const target = el('aside', { id: 'ember1234', cls: ['css-1x2y3z', 'rail'] });
    const body = el('body', {}, [target]);
    expect(selectorFor(target, counter({ 'aside.rail': 1 }))).toBe('aside.rail');
    expect(body.tagName).toBe('BODY');
  });
  it('stops at body', () => {
    const target = el('div');
    const wrap = el('div', {}, [target]);
    el('body', {}, [wrap, el('div')]);
    expect(selectorFor(target, counter({}))).toBe('body > div:nth-of-type(1) > div');
  });
  it('names similar elements by tag and stable classes', () => {
    expect(similarSelectorFor(el('div', { cls: ['ad-slot', 'css-abc123'] }))).toBe('div.ad-slot');
    expect(similarSelectorFor(el('div'))).toBe(null);
    expect(similarSelectorFor(el('body', { cls: ['home'] }))).toBe(null);
  });
});

describe('boosts: records', () => {
  it('makes ids and paths', () => {
    const id = newBoostId(Date.parse(NOW), () => 0.5);
    expect(isBoostId(id)).toBe(true);
    expect(boostPath(id)).toBe(`${BOOSTS_PREFIX}${id}.json`);
    expect(() => boostPath('../x')).toThrow();
    expect(newBoostId(1) < newBoostId(2)).toBe(true);
  });
  it('cleans the hide list', () => {
    expect(cleanHideList([' .a ', '.a', '', '.b'])).toEqual(['.a', '.b']);
    expect(() => cleanHideList(['.a { x }'])).toThrow(/can’t be used/);
    expect(cleanHideList(undefined)).toEqual([]);
  });
  it('makes a record, defaulting the name and keeping preset order', () => {
    const b = makeBoost(
      { id: 'b1', site: 'https://www.example.com/', presets: ['no-motion', 'dark', 'nope'], hide: ['.ad'] },
      null,
      NOW
    );
    expect(b).toEqual({
      type: 'nomad/boost',
      id: 'b1',
      name: 'example.com',
      site: 'example.com',
      enabled: true,
      presets: ['dark', 'no-motion'],
      hide: ['.ad'],
      css: '',
      js: '',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(isBoost(b)).toBe(true);
  });
  it('keeps what an update leaves out', () => {
    const b = makeBoost({ id: 'b1', site: 'example.com', name: 'Clean', css: 'a{}', hide: ['.ad'] }, null, NOW);
    const off = makeBoost({ id: 'b1', enabled: false }, b, LATER);
    expect(off).toMatchObject({ name: 'Clean', css: 'a{}', hide: ['.ad'], enabled: false, createdAt: NOW, updatedAt: LATER });
  });
  it('refuses what it can’t store', () => {
    expect(() => makeBoost({ id: '../x', site: 'example.com' })).toThrow(/boost id/);
    expect(() => makeBoost({ id: 'b1', site: '' })).toThrow(/needs a site/);
    expect(() => makeBoost({ id: 'b1', site: 'example.com', css: 'x'.repeat(200001) })).toThrow(/too long/);
    expect(isBoost({ type: 'nomad/boost', id: 'b1', site: 'bad site' })).toBe(false);
  });
  it('lists a page’s Boosts oldest first', () => {
    const later = boost({ site: 'example.com', name: 'Later' }, LATER);
    const first = boost({ site: 'www.example.com', name: 'First' }, NOW);
    const other = boost({ site: 'other.org' });
    expect(boostsFor('https://news.example.com/', [later, other, first]).map((b) => b.name)).toEqual([
      'First',
      'Later',
    ]);
  });
  it('describes a Boost in a few words', () => {
    const b = boost({ site: 'example.com', presets: ['dark'], hide: ['.a', '.b'], css: 'a{}', js: ' ' });
    expect(describeBoost(b)).toEqual(['Dark mode', '2 hidden', 'CSS']);
  });
});

describe('boosts: applying', () => {
  it('hides each selector with a rule of its own', () => {
    expect(hideCss(['.a', '#b > p', '.bad { x'])).toBe(
      '.a { display: none !important; }\n#b > p { display: none !important; }'
    );
  });
  it('mixes preset filters on the root, once each, and skips Boosts that are off', () => {
    const a = boost({ site: 'example.com', presets: ['dark', 'sepia'], css: 'body { color: red }' });
    const b = boost({ site: 'example.com', presets: ['dark'], hide: ['.ad'] }, LATER);
    const off = boost({ site: 'example.com', enabled: false, css: '.never {}' });
    const css = pageCss([a, b, off]);
    const dark = PRESETS.find((p) => p.id === 'dark');
    expect(css.startsWith('html { filter: invert(1) hue-rotate(180deg) sepia(0.45) brightness(0.97) !important; }')).toBe(true);
    expect(css.split(dark.css).length).toBe(2); // once, though two Boosts ask for it
    expect(css).toContain('body { color: red }');
    expect(css).toContain('.ad { display: none !important; }');
    expect(css).not.toContain('.never');
    expect(css.indexOf('color: red')).toBeLessThan(css.indexOf('.ad {'));
    expect(pageCss([off])).toBe('');
  });
  it('keeps a Boost’s name from ending a CSS comment', () => {
    const b = boost({ site: 'example.com', name: 'x */ body { display:none } /*', css: 'p{}' });
    expect(pageCss([b])).toContain('/* x * / body { display:none } /* */\np{}');
  });
  it('wraps a script so await works and errors carry its name', () => {
    const b = boost({ site: 'example.com', name: 'Auto "expand"', js: 'await 1; document.title = "x"' });
    const src = boostScript(b);
    expect(src).toContain('(async () => {\nawait 1; document.title = "x"\n})()');
    expect(src).toContain(JSON.stringify('Boost “Auto "expand"” failed:'));
    expect(src).toContain(`//# sourceURL=nomad-boost:///${b.id}.js`);
  });
  it('gives the page its CSS and scripts, with a rev that follows the code only', () => {
    const b = boost({ site: 'example.com', name: 'S', js: 'console.log(1)', hide: ['.a'] });
    const p = pagePayload('https://example.com/', [b]);
    expect(p.css).toContain('.a {');
    expect(p.scripts).toEqual([{ id: b.id, name: 'S', rev: codeRev('console.log(1)'), code: boostScript(b) }]);
    const zapped = makeBoost({ id: b.id, hide: ['.a', '.b'] }, b, LATER);
    expect(pagePayload('https://example.com/', [zapped]).scripts[0].rev).toBe(p.scripts[0].rev);
    expect(pagePayload('https://elsewhere.com/', [b])).toEqual({ css: '', scripts: [] });
    expect(pagePayload('https://example.com/', [makeBoost({ id: b.id, enabled: false }, b)])).toEqual({
      css: '',
      scripts: [],
    });
  });
});
