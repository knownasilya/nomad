// A Hyperdrive open of an Autobase core throws DECODING_ERROR and, if the namespaced
// Corestore is left open, the next Autobase ready() never finishes. openHyperdrive must
// release that namespace so the fallback load can proceed.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { createFsCore, AUTOBASE_OPTS, makeMetadata } from '../../shared/fs-core.mjs';
import { openHyperdrive } from '../../app/bg/hyper/open-hyperdrive.js';

let Autobase, Hyperbee, Corestore, b4a;
let open, apply;

async function loadAppDep(name) {
  const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'));
  const m = await import(pathToFileURL(rq.resolve(name)).href);
  return m.default ?? m;
}

beforeAll(async () => {
  [Autobase, Hyperbee, Corestore, b4a] = await Promise.all(
    ['autobase', 'hyperbee', 'corestore', 'b4a'].map(loadAppDep)
  );
  ({ open, apply } = createFsCore({ Hyperbee, b4a }));
});

async function persistAutobase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-ab-'));
  const store = new Corestore(dir);
  await store.ready();
  const ns = store.namespace(randomBytes(32));
  const base = new Autobase(ns, null, { open, apply, ...AUTOBASE_OPTS });
  await base.ready();
  await base.append({
    op: 'put',
    path: '/index.json',
    metadata: makeMetadata({ mtime: 1, ctime: 1 }),
    value: b4a.toString(b4a.from('{"title":"x"}'), 'base64'),
  });
  await base.update();
  const key = base.key;
  await base.close();
  await ns.close();
  return { dir, store, key };
}

describe('openHyperdrive on an Autobase core', () => {
  it('releases the core after DECODING_ERROR so Autobase can open it', async () => {
    const { dir, store, key } = await persistAutobase();
    try {
      await expect(openHyperdrive(store, key)).rejects.toMatchObject({ code: 'DECODING_ERROR' });

      const base = new Autobase(store, key, { open, apply, ...AUTOBASE_OPTS });
      const ready = base.ready();
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Autobase ready timed out')), 4000)
      );
      await Promise.race([ready, timeout]);
      await base.close();
    } finally {
      await store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
