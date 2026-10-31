// The rules behind the AI Sidebar's page control (ADR-0028): what it may touch, which clicks wait
// for the user, how long a site's yes lasts, and the keys pressKey knows. bg/ui/page-control.js
// runs the actions; this is the part with no Electron.

import { describe, it, expect } from 'vitest';
import {
  GRANT_DAYS,
  blockedReason,
  describeControl,
  directionArg,
  forModel,
  grantUntil,
  isPageAction,
  pageOffLimits,
  parseKey,
  refArg,
  riskyWords,
  screenshotPoint,
  siteOf,
  snapshotForModel,
  storedGrant,
  textArg,
} from '../../app/bg/ai/page-control.mjs';

const DAY = 24 * 60 * 60 * 1000;

describe('the site grant', () => {
  it('lasts 30 days from the yes', () => {
    const now = Date.UTC(2026, 9, 30);
    expect(GRANT_DAYS).toBe(30);
    expect(grantUntil(now)).toBe(now + 30 * DAY);
    expect(storedGrant(grantUntil(now), now + 29 * DAY)).toBe('allow');
    expect(storedGrant(grantUntil(now), now + 30 * DAY + 1)).toBe('ask');
  });

  it('reads the site-info panel’s Allow and Deny, which do not run out', () => {
    expect(storedGrant(1)).toBe('allow');
    expect(storedGrant(0)).toBe('deny');
    expect(storedGrant('1')).toBe('allow');
  });

  it('asks when nothing is stored', () => {
    expect(storedGrant(undefined)).toBe('ask');
    expect(storedGrant(null)).toBe('ask');
    expect(storedGrant('')).toBe('ask');
    expect(storedGrant('nonsense')).toBe('ask');
  });

  it('is per site: scheme and host', () => {
    expect(siteOf('https://shop.example.com/cart?x=1')).toBe('https://shop.example.com');
    expect(siteOf('hyper://abc123/posts/')).toBe('hyper://abc123');
    expect(siteOf('not a url')).toBe('');
  });
});

describe('pages the AI may control', () => {
  it('allows web and hyper:// pages', () => {
    expect(pageOffLimits('https://example.com/')).toBeNull();
    expect(pageOffLimits('http://localhost:3000/')).toBeNull();
    expect(pageOffLimits('hyper://abc123/')).toBeNull();
  });

  it("never Nomad's own pages or the private drive", () => {
    expect(pageOffLimits('nomad://settings/')).toMatch(/only control web/);
    expect(pageOffLimits('hyper://private/notes.md')).toMatch(/private drive/);
    expect(pageOffLimits('file:///etc/passwd')).toMatch(/only control web/);
    expect(pageOffLimits('')).toMatch(/no page/);
  });
});

describe('fields that are the user’s to fill', () => {
  it('blocks passwords, payment fields and file pickers', () => {
    expect(blockedReason({ tag: 'input', type: 'password' })).toBe('password');
    expect(blockedReason({ tag: 'input', type: 'text', autocomplete: 'one-time-code' })).toBe('password');
    expect(blockedReason({ tag: 'input', type: 'text', autocomplete: 'cc-number' })).toBe('payment');
    expect(blockedReason({ tag: 'input', type: 'text', autocomplete: 'shipping cc-csc' })).toBe('payment');
    expect(blockedReason({ tag: 'input', type: 'tel', nameAttr: 'cardNumber' })).toBe('payment');
    expect(blockedReason({ tag: 'input', type: 'text', id: 'cvv' })).toBe('payment');
    expect(blockedReason({ tag: 'input', type: 'file' })).toBe('file');
  });

  it('lets the rest through', () => {
    expect(blockedReason({ tag: 'input', type: 'email', autocomplete: 'email' })).toBeNull();
    expect(blockedReason({ tag: 'input', type: 'search', nameAttr: 'q' })).toBeNull();
    expect(blockedReason({ tag: 'button', type: null, name: 'Card settings' })).toBeNull();
    expect(blockedReason(null)).toBeNull();
  });

  it('never shows the model what a blocked field holds', () => {
    const out = forModel({ ref: 3, role: 'textbox', name: 'Password', type: 'password', value: 'hunter2', inView: true });
    expect(out).toEqual({ ref: 3, role: 'textbox', name: 'Password', blocked: 'password' });
  });
});

describe('clicks that wait for the user', () => {
  it('finds names that buy, send, post or delete', () => {
    for (const name of ['Buy now', 'Place order', 'Place your order', 'Pay $40', 'Checkout', 'Send', 'Post', 'Delete account', 'Subscribe', 'Publish']) {
      expect(riskyWords(name), name).toBeTruthy();
    }
  });

  it('leaves ordinary clicks alone', () => {
    for (const name of ['Sign in', 'Next', 'Posts', 'Sender settings', 'Search', 'Add to list', '', null]) {
      expect(riskyWords(name), String(name)).toBeNull();
    }
  });
});

describe('what the model sees', () => {
  const snap = {
    url: 'https://example.com/',
    title: 'Example',
    headings: ['Welcome'],
    more: 0,
    controls: [
      { ref: 1, role: 'link', name: '  Home  ', href: 'https://example.com/', inView: true, tag: 'a', nameAttr: '', id: 'nav-home' },
      { ref: 2, role: 'textbox', name: 'Search', value: '', inView: true, focused: true, tag: 'input', type: 'search' },
      { ref: 3, role: 'checkbox', name: 'Remember me', checked: false, inView: false, tag: 'input', type: 'checkbox' },
    ],
  };

  it('keeps what helps pick a control and drops the field attributes', () => {
    const out = snapshotForModel(snap);
    expect(out.controls).toEqual([
      { ref: 1, role: 'link', name: 'Home', href: 'https://example.com/' },
      { ref: 2, role: 'textbox', name: 'Search', focused: true },
      { ref: 3, role: 'checkbox', name: 'Remember me', checked: false, offscreen: true },
    ]);
    expect(out.headings).toEqual(['Welcome']);
  });

  it('lists only the controls on screen after an action', () => {
    const out = snapshotForModel(snap, { onlyInView: true });
    expect(out.controls.map((c) => c.ref)).toEqual([1, 2]);
    expect(out.note).toMatch(/snapshotPage lists them all/);
    expect(out.headings).toBeUndefined();
  });

  it('says when more controls are further down', () => {
    expect(snapshotForModel({ ...snap, more: 40 }).more).toMatch(/40 more/);
  });

  it('names a control for the sidebar and confirms', () => {
    expect(describeControl({ role: 'button', name: 'Sign in' })).toBe('button “Sign in”');
    expect(describeControl({ role: 'generic', name: 'Menu' })).toBe('element “Menu”');
    expect(describeControl({ role: 'link', name: '' })).toBe('link');
  });
});

describe('pressKey', () => {
  it('knows named keys and what they type', () => {
    expect(parseKey('Enter')).toEqual({ keyCode: 'Enter', modifiers: [], char: '\r' });
    expect(parseKey('escape')).toEqual({ keyCode: 'Escape', modifiers: [], char: null });
    expect(parseKey('ArrowDown')).toEqual({ keyCode: 'Down', modifiers: [], char: null });
    expect(parseKey('Space')).toEqual({ keyCode: 'Space', modifiers: [], char: ' ' });
    expect(parseKey('a')).toEqual({ keyCode: 'a', modifiers: [], char: 'a' });
  });

  it('takes modifiers joined by +', () => {
    expect(parseKey('Shift+Tab')).toEqual({ keyCode: 'Tab', modifiers: ['shift'], char: null });
    // A shortcut types nothing.
    expect(parseKey('Control+A')).toEqual({ keyCode: 'A', modifiers: ['control'], char: null });
    expect(parseKey('Cmd+Shift+z')).toEqual({ keyCode: 'z', modifiers: ['meta', 'shift'], char: null });
    expect(parseKey('Shift+A')).toEqual({ keyCode: 'A', modifiers: ['shift'], char: 'A' });
    expect(parseKey('+')).toEqual({ keyCode: '+', modifiers: [], char: '+' });
    expect(parseKey('Shift++')).toEqual({ keyCode: '+', modifiers: ['shift'], char: '+' });
  });

  it('refuses what it doesn’t know', () => {
    expect(() => parseKey('')).toThrow(/Pass `key`/);
    expect(() => parseKey('Hyper+A')).toThrow(/Unknown modifier/);
    expect(() => parseKey('F13')).toThrow(/Unknown key/);
  });
});

describe('arguments', () => {
  it('checks refs, text and directions', () => {
    expect(refArg({ ref: 4 })).toBe(4);
    expect(refArg({ ref: '7' })).toBe(7);
    expect(() => refArg({})).toThrow(/Pass `ref`/);
    expect(() => refArg({ ref: 0 })).toThrow(/Pass `ref`/);
    expect(() => refArg({ ref: 1.5 })).toThrow(/Pass `ref`/);
    expect(textArg({ text: '' })).toBe('');
    expect(() => textArg({})).toThrow(/text to type/);
    expect(() => textArg({ text: 'x'.repeat(5001) })).toThrow(/at most/);
    expect(directionArg({})).toBe('down');
    expect(directionArg({ direction: 'Top' })).toBe('top');
    expect(() => directionArg({ direction: 'sideways' })).toThrow(/direction is one of/);
  });

  it('maps a point in the screenshot to the page', () => {
    const shot = { width: 1280, height: 800, cssWidth: 1600, cssHeight: 1000 };
    expect(screenshotPoint({ x: 640, y: 400 }, shot)).toEqual({ x: 800, y: 500 });
    expect(() => screenshotPoint({ x: 1, y: 1 }, null)).toThrow(/Take a screenshot first/);
    expect(() => screenshotPoint({ x: 2000, y: 10 }, shot)).toThrow(/outside the screenshot/);
    expect(() => screenshotPoint({ x: 'a', y: 10 }, shot)).toThrow(/Pass `x` and `y`/);
  });

  it('names the page actions', () => {
    expect(isPageAction('clickElement')).toBe(true);
    expect(isPageAction('readCurrentPage')).toBe(false);
  });
});
