// Integration check for the discovery TRANSPORT (ADR-0016): drives the real announcer↔crawler path
// over a live Hyperswarm on a local hyperdht testnet, asserting a LISTING frame crosses the wire and
// lands searchable in the index. The heavy P2P deps (hyperswarm/corestore/hyperdht) live only in
// app/node_modules and don't play well inside vitest's transform, so we spawn the standalone script
// (app/tools/discovery-e2e.mjs) as a child Node process — it runs with the right module resolution
// and prints PASS/FAIL — and assert on its exit code. The frame codec + index logic are covered
// directly by crawler-index.test.js; this covers the swarm channel they can't.
import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const run = promisify(execFile);
const appDir = path.join(process.cwd(), 'app');

describe('discovery announcer↔crawler over a real swarm', () => {
  it(
    'delivers a LISTING frame across the wire and indexes it searchably',
    async () => {
      const { stdout } = await run('node', ['tools/discovery-e2e.mjs'], {
        cwd: appDir,
        timeout: 40000,
      });
      expect(stdout).toContain('announcer sent LISTING');
      expect(stdout).toContain('PASS');
    },
    45000
  );
});
