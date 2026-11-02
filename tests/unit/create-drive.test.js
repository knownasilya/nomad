// The createDrive capability (app/bg/ai/create-drive.mjs): the user's own AI makes a drive, as the
// Create Drive dialog does. The arguments it takes, what it returns, and who gets it.
import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_IDS,
  CREATE_DRIVE_PERM,
  newDriveOptions,
  createdDrive,
} from '../../app/bg/ai/create-drive.mjs';
import { DRIVE_TEMPLATES } from '../../app/lib/drive-templates.ts';
import { PERMS } from '../../app/lib/permissions.ts';
import { buildCatalog, assertCallAllowed } from '../../app/bg/ai/search-execute.mjs';
import { askOncePerTurn } from '../../app/bg/ai/vault-tools.mjs';
import { toolSummary } from '../../app/bg/ai/tool-summary.mjs';
import { parseItemLink } from '../../shared/item-links.mjs';

const KEY = 'c'.repeat(64);

describe('createDrive: options', () => {
  it('offers the templates the Create Drive dialog offers', () => {
    expect(TEMPLATE_IDS).toEqual(DRIVE_TEMPLATES.map((t) => t.id));
  });

  it('takes a title, and a blank drive unless told otherwise', () => {
    expect(newDriveOptions({ title: '  Trip   photos ' })).toEqual({ title: 'Trip photos', template: 'blank' });
    expect(
      newDriveOptions({ title: 'Plan', description: ' For the team ', template: 'Document', collaborative: false })
    ).toEqual({ title: 'Plan', description: 'For the team', template: 'document', collaborative: false });
    // Left out, the template decides whether it takes writers.
    expect(newDriveOptions({ title: 'Plan', template: 'document' })).not.toHaveProperty('collaborative');
    expect(newDriveOptions({ title: 'x', description: '', template: '' })).toEqual({ title: 'x', template: 'blank' });
  });

  it('refuses what the dialog would refuse, with a message the model can act on', () => {
    expect(() => newDriveOptions({})).toThrow(/needs a `title`/);
    expect(() => newDriveOptions({ title: '   ' })).toThrow(/needs a `title`/);
    expect(() => newDriveOptions(null)).toThrow(/needs a `title`/);
    expect(() => newDriveOptions({ title: 'x'.repeat(101) })).toThrow(/100 characters/);
    expect(() => newDriveOptions({ title: 'x', template: 'forum' })).toThrow(/"blank", "document"/);
    expect(() => newDriveOptions({ title: 'x', collaborative: 'yes' })).toThrow(/true or false/);
    expect(() => newDriveOptions({ title: 'x', description: 3 })).toThrow(/string/);
    expect(() => newDriveOptions({ title: 'x', description: 'y'.repeat(501) })).toThrow(/500 characters/);
  });

  it('returns the drive as a link the answer can use', () => {
    const made = createdDrive(`hyper://${KEY}`, { title: 'Trip photos', template: 'blank' }, { collaborative: false });
    expect(made).toMatchObject({ url: `hyper://${KEY}/`, title: 'Trip photos', template: 'blank', collaborative: false });
    expect(made.note).toContain(`[Trip photos](hyper://${KEY}/)`);
    expect(made.note).not.toMatch(/Draft/);
    expect(parseItemLink(made.url)).toEqual({ kind: 'page', url: `hyper://${KEY}/` });
    const staged = createdDrive(`hyper://${KEY}/`, { title: 'x', template: 'blank' }, { collaborative: true, draft: true });
    expect(staged.note).toMatch(/stage in its Draft/);
  });
});

describe('createDrive: who gets it', () => {
  const names = (c) => c.capabilities.map((x) => x.name);

  it('is the user\'s own AI\'s, never a page\'s chat', () => {
    expect(names(buildCatalog({ personal: false }))).not.toContain('createDrive');
    expect(() => assertCallAllowed('createDrive', 'createDrive', buildCatalog({}))).toThrow(/not available/);
    // The sidebar, the phone (remote) and another program over the loopback MCP (no tab).
    for (const o of [{ tab: true }, { tab: true, remote: true }, { tab: false }]) {
      const cat = buildCatalog({ personal: true, ...o });
      expect(names(cat)).toContain('createDrive');
      expect(() => assertCallAllowed('createDrive', 'createDrive', cat)).not.toThrow();
    }
  });

  it('is a Job\'s only with the newDrives grant, which also turns on writeDriveFile', () => {
    const job = (extra, allowWrite = false) => buildCatalog({ personal: true, remote: true, allowWrite, job: { extra } });
    expect(names(job([]))).not.toContain('createDrive');
    const granted = job(['createDrive'], true);
    expect(names(granted)).toEqual(expect.arrayContaining(['createDrive', 'writeDriveFile']));
  });

  it('asks its own permission, once a turn, and never keeps it', () => {
    expect(CREATE_DRIVE_PERM).toBe('aiCreateDrive');
    expect(PERMS.aiCreateDrive).toMatchObject({ persist: false, promptTrusted: true });
  });

  it('says what it is doing', () => {
    expect(toolSummary('createDrive', { title: 'Trip photos' })).toBe('Making the drive “Trip photos”');
    expect(toolSummary('createDrive', {})).toBe('Making a drive');
    expect(toolSummary('execute', { code: 'await nomad.createDrive({ title: "x" })' })).toBe('Running code to make a drive');
  });
});

describe('createDrive: the turn may write the drive it made', () => {
  it('allows a permission for the rest of the turn on every site, without asking', async () => {
    const asked = [];
    const ask = askOncePerTurn(async (p) => {
      asked.push(p);
      return false;
    });
    const tab = (url) => ({ getURL: () => url });
    expect(await ask(CREATE_DRIVE_PERM, tab('https://example.com/'))).toBe(false);
    expect(await ask(CREATE_DRIVE_PERM, tab('https://example.com/a'))).toBe(false);
    ask.allow(`modifyDrive:${KEY}`);
    expect(await ask(`modifyDrive:${KEY}`, tab('https://example.com/'))).toBe(true);
    expect(await ask(`modifyDrive:${KEY}`, tab('https://other.example/'))).toBe(true);
    // Only that drive: another one still asks.
    expect(await ask(`modifyDrive:${'d'.repeat(64)}`, tab('https://example.com/'))).toBe(false);
    expect(asked).toEqual([CREATE_DRIVE_PERM, `modifyDrive:${'d'.repeat(64)}`]);
  });
});
