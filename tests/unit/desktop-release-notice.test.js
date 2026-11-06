import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  versionId,
  releaseNotesUrl,
  shouldShowNotice,
} from '../../app/userland/desktop/js/lib/release.js';

describe('new tab release notice', () => {
  it('reads release and beta versions', () => {
    expect(parseVersion('1.44.0')).toEqual({ major: 1, minor: 44, patch: 0, pre: 0, prerelease: false });
    expect(parseVersion('1.45.0-beta.2')).toMatchObject({ minor: 45, pre: 2, prerelease: true });
    expect(parseVersion('nope')).toBe(null);
  });

  it('links a release to its news post and a beta to the News list', () => {
    expect(releaseNotesUrl('1.44.0')).toBe('https://nomad.pages.dev/posts/whats-new-in-1-44/');
    expect(releaseNotesUrl('1.44.3')).toBe('https://nomad.pages.dev/posts/whats-new-in-1-44/');
    expect(releaseNotesUrl('1.45.0-beta.0')).toBe('https://nomad.pages.dev/posts/');
  });

  it('orders versions, a beta before its release', () => {
    expect(versionId('1.44.1')).toBeGreaterThan(versionId('1.44.0'));
    expect(versionId('1.45.0')).toBeGreaterThan(versionId('1.45.0-beta.3'));
    expect(versionId('1.45.0-beta.3')).toBeGreaterThan(versionId('1.44.9'));
  });

  it('shows once per new version', () => {
    // What the old page stored for its hard-coded 1.2.1.
    const old = String(1 * 1e9 + 2 * 1e6 + 1 * 1e3);
    expect(shouldShowNotice('1.44.0', old)).toBe(true);
    expect(shouldShowNotice('1.44.0', undefined)).toBe(true);
    expect(shouldShowNotice('1.44.0', String(versionId('1.44.0')))).toBe(false);
    expect(shouldShowNotice('1.44.1', String(versionId('1.44.0')))).toBe(true);
    expect(shouldShowNotice('garbage', undefined)).toBe(false);
  });
});
