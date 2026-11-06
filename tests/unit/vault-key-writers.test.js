// A Device's Vault key is its Vault writer core. It must never be a Writer of a Root Drive (or any
// other drive): the drive reads that core's Vault ops into its own view, and the core's checkpoints
// name the Vault's system core, so Autobase fast-forwards the drive towards the Vault and closes it
// ("Cannot read properties of null (reading 'core')" in _applyFastForward). That broke making a
// Space, and Set up a home, on a Vault with two or more other Devices (vault.js _neverAddVaultKeys).

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { randomBytes } from 'crypto';
import {
  createFsCore,
  AUTOBASE_OPTS,
  makeMetadata,
} from '../../shared/fs-core.mjs';

let Autobase, Hyperbee, Corestore, b4a;
let open, apply;

async function loadAppDep(name) {
  const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'));
  const m = await import(pathToFileURL(rq.resolve(name)).href);
  return m.default ?? m;
}

beforeAll(async () => {
  [Autobase, Hyperbee, Corestore, b4a] = await Promise.all(
    ['autobase', 'hyperbee', 'corestore', 'b4a'].map(loadAppDep),
  );
  ({ open, apply } = createFsCore({ Hyperbee, b4a }));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (buf) => b4a.toString(buf, 'hex');

async function until(check, ms = 20000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(100);
  }
}

describe('a Vault key as a Writer of a Root Drive', () => {
  it('pulls the Vault into the drive and points its checkpoints at the Vault', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-vault-key-'));
    const stores = ['desktop', 'phone', 'laptop'].map(
      (n) => new Corestore(path.join(dir, n)),
    );
    const streams = [];
    for (let i = 0; i < stores.length; i++) {
      for (let j = i + 1; j < stores.length; j++) {
        const a = stores[i].replicate(true);
        const b = stores[j].replicate(false);
        a.pipe(b).pipe(a);
        streams.push(a, b);
      }
    }
    const mk = (store, key) =>
      new Autobase(store, key, { open, apply, ...AUTOBASE_OPTS });
    const put = async (base, p) => {
      await base.append({
        op: 'put',
        path: p,
        metadata: makeMetadata({ mtime: 1, ctime: 1 }),
        value: b4a.toString(b4a.from('{}'), 'base64'),
      });
      await base.update();
    };

    const bases = [];
    try {
      // The Vault: this desktop, plus a phone and a laptop that paired in.
      const vault = mk(stores[0].session(), null);
      await vault.ready();
      const others = [];
      for (const s of stores.slice(1)) {
        const v = mk(s.session(), vault.key);
        await v.ready();
        others.push(v);
      }
      bases.push(vault, ...others);
      for (const v of others)
        await vault.append({ addWriter: hex(v.local.key) });
      await vault.update();
      await until(async () => {
        for (const v of others) await v.update();
        return others.every((v) => v.writable);
      });
      for (const v of others)
        await put(v, `/.vault/notes/${hex(v.local.key).slice(0, 8)}.json`);

      // A new Space's Root Drive on this desktop, in its own namespace, as createCollaborativeDrive
      // makes it. What the old fan-out did: the other Devices' Vault keys as its Writers.
      const root = mk(stores[0].namespace(randomBytes(32)), null);
      await root.ready();
      bases.push(root);
      await put(root, '/drives.json');
      for (const v of others)
        await root.append({ addWriter: hex(v.local.key) });
      await root.update();

      // The Vault's records turn up in the Root Drive...
      await until(async () => {
        await root.update();
        return !!(await root.view.get(
          '/.vault/notes/' + hex(others[0].local.key).slice(0, 8) + '.json',
        ));
      });
      // ...and the drive now takes the Vault's system core for its own next state.
      for (const v of others)
        await put(v, '/.vault/more-' + hex(v.local.key).slice(0, 8));
      const vaultSystem = hex(vault.core.key);
      await until(async () => {
        await root.update();
        const digests = root._applyState.checkpoints.map(
          (c) => c.digest && hex(c.digest.key),
        );
        return digests.includes(vaultSystem);
      });
      expect(hex(root.core.key)).not.toBe(vaultSystem);
    } finally {
      for (const b of bases) await b.close().catch(() => {});
      for (const s of streams) s.destroy();
      for (const s of stores) await s.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe('vault.js', () => {
  it('never adds a Device’s Vault key as a Writer of a Root Drive', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/bg/hyper/vault.js'),
      'utf8',
    );
    expect(src).not.toMatch(/fanOutAddWriter|_addDevicesAsWriters/);
    expect(src).not.toMatch(/root\.base\.append\(\{\s*addWriter/);
    // Pairing adds the key to the Vault itself, and nowhere else.
    expect(src.match(/append\(\{\s*addWriter:/g) || []).toHaveLength(1);
  });
});
