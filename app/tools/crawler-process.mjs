// Entry point for the crawler when the browser runs it (bg/hyper/crawler-host.js), in an Electron
// utility process so the crawler's own swarm and corestore stay out of the main process.
//
// scripts/build.js bundles this file to crawler-process.build.js, inlining crawler.mjs and the
// repo-root shared/ modules it imports: shared/ sits outside app/, so a packaged build has no copy
// of it to import at run time. npm packages stay external and resolve from app/node_modules.
//
// argv: --port <n> --host <addr> --storage <dir>.
// Messages from the parent:
//   'stop'                          close the crawler and exit
//   { type: 'listings', frames }    this browser's own listed Drives (LISTING frames, full set)

import { startCrawler } from './crawler.mjs';

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
}

let crawler = null;
let localFrames = null; // the latest local listings, kept until the crawler is up

// Listen from the start: the parent sends the local listings right after it forks this process.
process.parentPort?.on('message', async (e) => {
  const msg = e?.data;
  if (msg === 'stop') {
    try {
      await crawler?.close();
    } finally {
      process.exit(0);
    }
  } else if (msg?.type === 'listings' && Array.isArray(msg.frames)) {
    localFrames = msg.frames;
    crawler?.applyLocalListings(localFrames);
  }
});

startCrawler({
  port: Number(args.port) || undefined,
  host: args.host || undefined,
  storage: args.storage || undefined,
})
  .then((c) => {
    crawler = c;
    if (localFrames) crawler.applyLocalListings(localFrames);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[crawler] failed to start', err);
    process.exit(1);
  });
