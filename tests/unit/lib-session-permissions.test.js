import { describe, it, expect } from 'vitest';
import {
  validateAndNormalizePermissions,
  enumeratePerms,
} from '../../app/lib/session-permissions.js';

describe('validateAndNormalizePermissions', () => {
  it('accepts valid publicFiles permissions', () => {
    expect(() =>
      validateAndNormalizePermissions({
        publicFiles: [{ path: '/posts/*.md', access: 'write' }],
      })
    ).not.toThrow();
  });

  it('accepts valid privateFiles permissions', () => {
    expect(() =>
      validateAndNormalizePermissions({
        privateFiles: [{ path: '/notes/*.txt', access: 'read' }],
      })
    ).not.toThrow();
  });

  it('throws for non-object input', () => {
    expect(() => validateAndNormalizePermissions('bad')).toThrow();
  });

  it('throws for invalid permission key', () => {
    expect(() =>
      validateAndNormalizePermissions({ invalidKey: [] })
    ).toThrow(/Invalid permission key/);
  });

  it('throws when files array item has no path', () => {
    expect(() =>
      validateAndNormalizePermissions({ publicFiles: [{ access: 'read' }] })
    ).toThrow();
  });

  it('throws when path has no extension', () => {
    expect(() =>
      validateAndNormalizePermissions({
        publicFiles: [{ path: '/posts/*', access: 'read' }],
      })
    ).toThrow(/extension/);
  });

  it('normalizes prefix to not have trailing slash', () => {
    const perms = { publicFiles: [{ path: '/posts/*.md', access: 'write' }] };
    validateAndNormalizePermissions(perms);
    expect(perms.publicFiles[0].prefix).not.toMatch(/\/$/);
  });

  it('defaults access to read when not provided', () => {
    const perms = { publicFiles: [{ path: '/posts/*.md' }] };
    validateAndNormalizePermissions(perms);
    expect(perms.publicFiles[0].access).toBe('read');
  });

  it('throws for invalid access value', () => {
    expect(() =>
      validateAndNormalizePermissions({
        publicFiles: [{ path: '/posts/*.md', access: 'delete' }],
      })
    ).toThrow(/access/);
  });
});

describe('enumeratePerms', () => {
  it('skips publicFiles read-only entries', () => {
    const perms = {
      publicFiles: [{ path: '/posts/*.md', access: 'read' }],
    };
    validateAndNormalizePermissions(perms);
    const result = enumeratePerms(perms);
    expect(result).toHaveLength(0);
  });

  it('includes publicFiles write entries', () => {
    const perms = {
      publicFiles: [{ path: '/posts/*.md', access: 'write' }],
    };
    validateAndNormalizePermissions(perms);
    const result = enumeratePerms(perms);
    expect(result).toHaveLength(1);
    expect(result[0].access).toBe('write');
    expect(result[0].location).toBe('public');
  });

  it('includes all privateFiles entries', () => {
    const perms = {
      privateFiles: [
        { path: '/notes/*.txt', access: 'read' },
        { path: '/drafts/*.md', access: 'write' },
      ],
    };
    validateAndNormalizePermissions(perms);
    const result = enumeratePerms(perms);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.location === 'private')).toBe(true);
  });

  it('includes extension and prefix in each entry', () => {
    const perms = {
      privateFiles: [{ path: '/notes/*.txt', access: 'read' }],
    };
    validateAndNormalizePermissions(perms);
    const result = enumeratePerms(perms);
    expect(result[0].extension).toBe('.txt');
    expect(result[0].prefix).toBe('/notes');
  });
});
