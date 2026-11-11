import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The scrollbars and form controls of nomad:// pages follow light and dark. Chromium takes the
// page's scrollbar scheme from the root element, so `color-scheme` must sit on :root (a body rule
// alone leaves a light scrollbar on a dark page). app-stdlib's colors.css sets it for every app that
// imports common.css or colors.css.
const userland = path.join(import.meta.dirname, '../../app/userland');
const read = (p) => fs.readFileSync(path.join(userland, p), 'utf8');

describe('nomad:// pages draw their scrollbars in the theme', () => {
  it('colors.css puts color-scheme on the root element', () => {
    expect(read('app-stdlib/css/colors.css')).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark/);
  });

  it('every app stylesheet imports common.css (and so colors.css)', () => {
    const missing = fs
      .readdirSync(userland)
      .filter((app) => fs.existsSync(path.join(userland, app, 'css/main.css')))
      .filter((app) => !/app-stdlib\/css\/(common|colors)\.css/.test(read(`${app}/css/main.css`)));
    expect(missing).toEqual([]);
  });

  it('the explorer, which has its own index.css, sets it too', () => {
    expect(read('explorer/index.css')).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark/);
  });
});
