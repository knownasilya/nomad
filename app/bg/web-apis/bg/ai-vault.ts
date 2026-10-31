// The AI's Notes, Highlights, Reader, Mods, Jobs and memory capabilities (search-execute.mjs CAPABILITIES,
// ADR-0019, ADR-0023, ADR-0030): the
// Vault and Drive reads and writes behind them. ai.ts executeTool calls runVaultTool on a personal turn only
// (the user's own AI); each capability first asks its permission (vault-tools.mjs VAULT_TOOL_PERMS).
//
// Notes belong to the user, or to a Space (ADR-0029). Reader follows belong to a Space. The Space is
// the calling tab's, or, for a turn another Device asked for over the AI Bridge, the one that Device
// sent. The AI sees the user's Notes and that Space's; a Note it creates is the user's.

import * as apps from '../../../../shared/vault-apps.mjs';
import * as vaultApps from './vault-apps';
import { highlightForAi, assertCanHighlight } from '../../ui/highlights';
import * as mods from '../../ui/mods';
import * as jobs from '../../ai/jobs';
import * as memory from '../../ai/memory';
import { readJobSource } from './job-source';
import * as vault from '../../hyper/vault';
import { describeSchedule } from '../../../../shared/jobs.mjs';
import fsAPI from './fs';
import {
  VAULT_TOOL_PERMS,
  findNotes,
  findNote,
  noteForModel,
  loadFeedPosts,
  findPosts,
  splitPostUrl,
  POST_BODY_FILES,
  htmlToText,
  clip,
  findMods,
  modForModel,
  findJobs,
  jobForModel,
} from '../../ai/vault-tools.mjs';

// A feed that doesn't answer in this time is listed with an error, so one offline peer can't stall
// the turn.
const FEED_TIMEOUT_MS = 8000;

type LoadedFeed = { url: string; title: string; posts: any[]; error?: string };

export function isVaultTool(name) {
  return Object.prototype.hasOwnProperty.call(VAULT_TOOL_PERMS, name);
}

// opts: ctx ({ sender }), space (a Space key from another Device's turn, else null: the sender's
// Space), permit (permission, sender) -> Promise<boolean>.
export async function runVaultTool(name, args, { ctx, space = null, permit }) {
  const permission = VAULT_TOOL_PERMS[name];
  if (name === 'highlightText') assertCanHighlight(ctx.sender, args);
  if (!(await permit(permission, ctx.sender)))
    throw new Error(`The user didn't allow ${permission}`);
  const readerSpace = async () => (apps.isSpaceKey(space) ? space : vaultApps.spaceKey(ctx));
  const json = (v) => JSON.stringify(v, null, 2);
  const notes = async () => vaultApps.allNotes(await readerSpace().catch(() => null));

  switch (name) {
    case 'listNotes':
      return json(findNotes(await notes(), args));

    case 'readNote': {
      const note = findNote(await notes(), args);
      if (!note) throw new Error('No note with that id or title. Use listNotes to find it.');
      return json(noteForModel(note));
    }

    case 'writeNote': {
      const { id, body, baseUpdatedAt } = args;
      if (typeof body !== 'string') throw new Error('writeNote needs the whole note as `body`');
      if (id) {
        if (!baseUpdatedAt) {
          throw new Error(
            'To edit a note, read it first (readNote) and pass its updatedAt as baseUpdatedAt'
          );
        }
        if (!findNote(await notes(), { id })) throw new Error('No note with that id');
      }
      const note = await vaultApps.saveNote(ctx, {
        id: id || undefined,
        body,
        baseUpdatedAt,
        space: await readerSpace().catch(() => null),
      });
      return json({
        id: note.id,
        title: apps.noteTitle(note.body),
        updatedAt: note.updatedAt,
        // It changed on another Device since it was read: this text is a new Note beside it.
        conflictCopy: !!id && note.id !== id,
      });
    }

    // Marks text on the page in the user's tab (ctx.sender), with a Note if the AI wrote one.
    case 'highlightText':
      return json(await highlightForAi(ctx.sender, args));

    case 'listReaderPosts': {
      const { follows, read } = await vaultApps.readerOf(await readerSpace());
      const only = args.feed ? apps.driveRoot(args.feed) : null;
      if (args.feed && !follows.includes(only))
        throw new Error("The user doesn't follow that feed in Reader");
      const roots = only ? [only] : follows;
      const feeds = await Promise.all(roots.map((root) => loadFeed(ctx, root)));
      return json({
        feeds: feeds.map((f) => ({
          url: f.url,
          title: f.title,
          ...(f.error ? { error: f.error } : {}),
        })),
        posts: findPosts(feeds, read, args),
      });
    }

    case 'readReaderPost': {
      const post = splitPostUrl(args.url);
      if (!post) throw new Error('Pass a post URL from listReaderPosts');
      const { follows, read } = await vaultApps.readerOf(await readerSpace());
      if (!follows.includes(post.root))
        throw new Error("That post isn't from a feed the user follows in Reader");
      return json(await readPost(ctx, post, read));
    }

    case 'followFeed': {
      const root = apps.driveRoot(args.url);
      if (!root) throw new Error("Pass the feed's hyper:// URL");
      await vaultApps.followIn(await readerSpace(), root);
      return `Following ${root} in Reader`;
    }

    case 'unfollowFeed': {
      const root = apps.driveRoot(args.url);
      if (!root) throw new Error("Pass the feed's hyper:// URL");
      await vaultApps.unfollowIn(await readerSpace(), root);
      return `Stopped following ${root} in Reader`;
    }

    case 'markPostsRead': {
      const urls = Array.isArray(args.urls) ? args.urls.filter((u) => typeof u === 'string') : [];
      if (!urls.length) throw new Error('Pass the post URLs as `urls`');
      await vaultApps.saveReadIn(await readerSpace(), urls);
      return `Marked ${urls.length} post${urls.length === 1 ? '' : 's'} read`;
    }

    case 'listMods':
      return json(findMods(mods.list(), args));

    // A new Mod (no id; `site` required) or changes to one. Fields left out keep their values.
    case 'saveMod': {
      const { id, name, site, enabled, presets, hide, css, js } = args;
      if (id && !mods.get(id)) throw new Error('No Mod with that id. Use listMods to find it.');
      if (!id && !site) throw new Error('A new Mod needs `site`, like example.com');
      for (const [key, v] of Object.entries({ presets, hide })) {
        if (v !== undefined && !Array.isArray(v)) throw new Error(`\`${key}\` must be an array of strings`);
      }
      const rec = await mods.save({ id, name, site, enabled, presets, hide, css, js });
      return json({ ...modForModel(rec), created: !id });
    }

    case 'deleteMod': {
      const b = mods.get(args.id);
      if (!b) throw new Error('No Mod with that id. Use listMods to find it.');
      await mods.remove(b.id);
      return `Deleted the Mod “${b.name}” for ${b.site}`;
    }

    case 'listJobs':
      return json(findJobs(jobs.list(), args, await deviceNamer()));

    // A new Job (no id; `prompt` or `source` required) or changes to one. A new Job runs on this
    // computer and reads the Reader of this turn's Space. A source is read now: the user's own drive
    // stays live, anyone else's is copied. The AI can't take a newer version of a copy: the user
    // does, in My Library.
    case 'saveJob': {
      const { id, title, prompt, schedule, notify, enabled } = args;
      const prev = id ? jobs.get(id) : null;
      if (id && !prev) throw new Error('No Job with that id. Use listJobs to find it.');
      if (!id && !prompt && !args.source) {
        throw new Error('A new Job needs `prompt` (what the AI does each run) or `source` (a drive with job.js or job.md)');
      }
      let source;
      let kept = false;
      if (args.source === null) source = null;
      else if (args.source !== undefined) {
        const read = await readJobSource(String(args.source));
        kept = !!prev?.source && !prev.source.live && !read.live && prev.source.url === read.url;
        if (!kept) source = read;
      }
      const space = id ? undefined : await readerSpace().catch(() => null);
      const rec = await jobs.save({ id, title, prompt, source, schedule, notify, enabled, space });
      const row = jobs.list().find((j) => j.id === rec.id) || rec;
      return json({
        ...jobForModel(row, await deviceNamer()),
        created: !id,
        ...(kept ? { note: 'The Job keeps its copy of this drive. The user takes a newer version in My Library → Jobs.' } : {}),
      });
    }

    case 'runJob': {
      const job = jobs.get(args.id);
      if (!job) throw new Error('No Job with that id. Use listJobs to find it.');
      jobs.runNow(job.id);
      return `Started “${job.title}” in the background. Its answer is saved with the Job (My Library → Jobs).`;
    }

    case 'deleteJob': {
      const job = jobs.get(args.id);
      if (!job) throw new Error('No Job with that id. Use listJobs to find it.');
      await jobs.remove(job.id);
      return `Deleted the Job “${job.title}” (${describeSchedule(job.schedule).toLowerCase()})`;
    }

    // What the AI remembers about the user (bg/ai/memory.js, ADR-0032). A new memory that says what
    // one already says is not saved twice.
    case 'remember': {
      if (!(await memory.isEnabled())) throw new Error('The user turned AI memory off');
      const id = typeof args.id === 'string' && args.id ? args.id : undefined;
      if (id && !memory.get(id)) throw new Error('No memory with that id');
      const rec: any = await memory.save({ id, text: args.text, by: 'ai' });
      if (rec.existed) return `Already remembered [${rec.id}]: ${rec.text}`;
      return `${id ? 'Changed' : 'Remembered'} [${rec.id}]: ${rec.text}`;
    }

    case 'forget': {
      const m = memory.get(args.id);
      if (!m) throw new Error('No memory with that id');
      await memory.remove(m.id);
      return `Forgot: ${m.text}`;
    }
  }
  throw new Error(`Unknown capability ${name}`);
}

// The Feed's published files, as the Reader reads them (never this Device's Draft of it).
function readText(ctx, root, path) {
  return fsAPI.readFile.call(ctx, root + path.replace(/^\//, ''), { draft: false });
}

async function loadFeed(ctx, root): Promise<LoadedFeed> {
  let timer;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The feed did not answer')), FEED_TIMEOUT_MS);
  });
  try {
    const load = loadFeedPosts(root, {
      readText: (path) => readText(ctx, root, path),
      listKeys: async (dir) => {
        const entries = await fsAPI.list.call(ctx, root + dir.replace(/^\//, ''), {
          recursive: true,
          draft: false,
        });
        return (entries || []).map((e) => e.key).filter((k) => typeof k === 'string');
      },
    });
    return await Promise.race([load, timeout]);
  } catch (err) {
    return { url: root, title: root, posts: [], error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// A post's metadata and text: post.json, then the first body file that exists.
async function readPost(ctx, { root, dir }, read) {
  const meta = JSON.parse(await readText(ctx, root, dir + 'post.json'));
  let feedTitle = root;
  try {
    feedTitle = JSON.parse(await readText(ctx, root, '/index.json')).title || root;
  } catch {}
  for (const file of POST_BODY_FILES) {
    let body;
    try {
      body = await readText(ctx, root, dir + file);
    } catch {
      continue;
    }
    const format = file.split('.').pop();
    return {
      url: root + dir.slice(1),
      feedUrl: root,
      feedTitle,
      title: meta.title || '',
      summary: meta.summary || '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      createdAt: meta.createdAt || '',
      read: read.includes(root + dir.slice(1)),
      format,
      text: clip(format === 'html' ? htmlToText(body) : body),
    };
  }
  throw new Error('This post has no text file');
}

// Names a Device by its Vault key: "this computer", or the name the user gave it.
async function deviceNamer(): Promise<(key: string) => string> {
  const [own, devices] = await Promise.all([
    jobs.ownKey().catch(() => null),
    vault.listDevices().catch(() => []),
  ]);
  const names = new Map<string, string>((devices || []).map((d: any) => [d.key, d.name]));
  return (key) => (key === own ? 'this computer' : names.get(key) || 'another device');
}
