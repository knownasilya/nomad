// nomad/shared/inbox-engine.mjs
//
// The Persona Inbox's moving parts (ADR-0036 §4, §6, §7.3), shared by desktop (bg/hyper/inbox.js)
// and the phone (mobile/backend/lib/inbox.mjs): the mailbox servers this Device answers, the outbox
// that delivers what the user wrote, the checks of a sender against their profile, and the check of
// the user's own published keys. The rules it applies are shared/inbox.mjs.
//
// No imports beyond inbox.mjs. Everything that touches the runtime comes in `deps`:
//
//   crypto                     cryptoFromSodium(sodium)
//   randomBytes(n)             -> Uint8Array
//   sha256hex(string)          -> hex
//   store                      the Vault's app records:
//     read(path) / list(prefix) / listPaths(prefix) / put(path, obj) / del(path)
//   listen(keyPair, onConn)    -> Promise<{ close() }>   a HyperDHT server on that key pair
//   connect(publicKey)         -> a duplex stream to that key, from a fresh key pair every time
//   remoteAddress(conn)        -> string (rate limits)
//   personas()                 -> [{ id, profileUrl, label, usable }]  usable: the writer check passed
//   vaultReady()               -> bool
//   deviceKey()                -> hex | null   this Device's Vault key
//   deviceKeys()               -> [hex]        every Device in the Vault
//   readProfile(url)           -> Promise<index.json | null>   (with its own timeout)
//   writeProfileInbox(personaId, inbox | null) -> Promise<bool>  false when this Device can't write it
//   notify?({ personaId, conversationKey, from, title, text })
//   onChange?()                something the UI shows changed
//   log?                       { info, warn }
//   now?()                     -> ms

import * as I from './inbox.mjs';

const ACK_TIMEOUT = 15000;
const CONN_TIMEOUT = 20000;
const TICK_MS = 15000;
const RECHECK_MS = 2 * 60 * 1000;
const PROFILE_TTL = 60 * 1000;

export function createInboxEngine(deps) {
  const { crypto, store } = deps;
  const now = deps.now || (() => Date.now());
  const log = deps.log || { info() {}, warn() {} };
  const changed = () => {
    try {
      deps.onChange?.();
    } catch {}
  };

  const servers = new Map(); // personaId -> { keyHex, server, keys, rec }
  const limiters = new Map(); // personaId -> rateLimiter
  const status = new Map(); // personaId -> { state: 'on'|'off'|'paused'|'changed'|'not-ready', reason }
  const profiles = new Map(); // profile URL -> { at, manifest }
  const lastCheck = new Map(); // record path -> ms
  const delivering = new Set(); // record paths in flight
  let timer = null;
  let closed = false;
  let reconciling = null;
  let again = false;

  // Records
  // =

  async function inboxOf(personaId) {
    const rec = await store.read(I.inboxPath(personaId)).catch(() => null);
    return I.isInbox(rec) ? rec : null;
  }

  function keysOf(rec, seed = rec.seed) {
    return I.inboxKeys(seed, crypto, deps.deviceKeys());
  }

  function knownKeys(rec) {
    return I.liveSeeds(rec, now()).map((s) => I.publicKeys(keysOf(rec, s)));
  }

  function personaById(id) {
    return deps.personas().find((p) => p.id === id) || null;
  }

  const profileHash = (url) => deps.sha256hex(I.profileKeyOf(url));
  const convKey = (a, b) => deps.sha256hex(I.conversationKeyInput(a, b));

  async function contactOf(personaId, profileUrl) {
    const rec = await store
      .read(I.contactPath(personaId, profileHash(profileUrl)))
      .catch(() => null);
    return I.isContact(rec) ? rec : null;
  }

  async function putContact(personaId, profileUrl, fields) {
    const path = I.contactPath(personaId, profileHash(profileUrl));
    const prev = await store.read(path).catch(() => null);
    const rec = I.makeContact(
      { personaId, profileUrl, ...fields },
      I.isContact(prev) ? prev : null,
      new Date(now()).toISOString()
    );
    await store.put(path, rec);
    return rec;
  }

  async function profile(url, fresh = false) {
    const hit = profiles.get(url);
    if (hit && !fresh && now() - hit.at < PROFILE_TTL) return hit.manifest;
    const manifest = await deps.readProfile(url).catch(() => null);
    if (manifest || !hit) profiles.set(url, { at: now(), manifest });
    return manifest || hit?.manifest || null;
  }

  // Mailboxes (§4) and the published keys (§7.3)
  // =

  function schedule() {
    if (reconciling) {
      again = true;
      return reconciling;
    }
    reconciling = (async () => {
      do {
        again = false;
        await reconcileOnce().catch((e) =>
          log.warn('Inbox reconcile failed', { error: String(e) })
        );
      } while (again && !closed);
    })().finally(() => {
      reconciling = null;
    });
    return reconciling;
  }

  async function reconcileOnce() {
    if (closed) return;
    const ready = deps.vaultReady();
    const me = deps.deviceKey();
    const want = new Map();
    for (const p of deps.personas()) {
      const rec = ready ? await inboxOf(p.id) : null;
      if (!rec) {
        status.set(p.id, { state: ready ? 'off' : 'not-ready', reason: '' });
        continue;
      }
      if (rec.previous && I.forgetLapsed(rec, now()) !== rec) {
        await store.put(I.inboxPath(p.id), I.forgetLapsed(rec, now())).catch(() => {});
      }
      if (!p.usable) {
        status.set(p.id, {
          state: 'paused',
          reason: 'This Persona’s profile drive didn’t pass the writer check, so its inbox is off.',
        });
        continue;
      }
      const verdict = await checkOwnProfile(p, rec);
      if (verdict === 'changed') {
        status.set(p.id, {
          state: 'changed',
          reason: `Someone changed the inbox address on your Persona “${p.label}”.`,
        });
        continue;
      }
      if (!me) {
        status.set(p.id, { state: 'not-ready', reason: '' });
        continue;
      }
      status.set(p.id, { state: 'on', reason: verdict === 'unpublished' ? 'publishing' : '' });
      want.set(p.id, rec);
    }
    // Close mailboxes no longer wanted, or whose keys changed.
    for (const [id, s] of servers) {
      const rec = want.get(id);
      if (
        !rec ||
        s.seed !== rec.seed ||
        s.previousSeed !== (rec.previous?.seed || null) ||
        s.device !== me
      ) {
        servers.delete(id);
        await s.close().catch(() => {});
      } else {
        s.rec = rec;
      }
    }
    for (const [id, rec] of want) {
      if (servers.has(id)) continue;
      const own = I.inboxKeys(rec.seed, crypto, [me]).mailboxes[0];
      const mine = [own];
      if (rec.previous?.seed && Date.parse(rec.previous.until) > now())
        mine.push(I.inboxKeys(rec.previous.seed, crypto, [me]).mailboxes[0]);
      const entry = {
        seed: rec.seed,
        previousSeed: rec.previous?.seed || null,
        device: me,
        rec,
        list: [],
      };
      for (const mb of mine) {
        try {
          const srv = await deps.listen(mb.keyPair, (conn) => onConnection(id, conn));
          entry.list.push(srv);
        } catch (e) {
          log.warn('Inbox mailbox could not listen', { error: String(e) });
        }
      }
      entry.close = async () => {
        for (const srv of entry.list) await Promise.resolve(srv.close()).catch(() => {});
      };
      servers.set(id, entry);
      log.info('Inbox mailbox listening', { persona: id });
    }
    changed();
  }

  // Compare the inbox the Profile Drive publishes with what the Vault's seed gives. 'changed' stops
  // the mailbox; 'unpublished' means this Device can't write the drive yet and another will.
  async function checkOwnProfile(p, rec) {
    const manifest = await profile(p.profileUrl, true);
    if (!manifest) return 'unpublished'; // not loaded yet: never raise the alarm on that (§7.3)
    const pub = I.publicKeys(keysOf(rec));
    const wanted = I.publishedInbox(rec, pub);
    const verdict = I.checkPublished(manifest.inbox, wanted, knownKeys(rec));
    if (verdict === 'ok') return 'ok';
    if (verdict === 'changed') return 'changed';
    const wrote = await deps.writeProfileInbox(p.id, wanted).catch(() => false);
    if (wrote) profiles.delete(p.profileUrl);
    return wrote ? 'ok' : 'unpublished';
  }

  // Receiving (§4, §6)
  // =

  function onConnection(personaId, conn) {
    const reader = I.frameReader();
    let done = false;
    const end = () => {
      done = true;
      try {
        conn.end();
      } catch {}
    };
    const t = setTimeout(() => {
      try {
        conn.destroy();
      } catch {}
    }, CONN_TIMEOUT);
    conn.on('error', () => {});
    conn.on('close', () => clearTimeout(t));
    let limiter = limiters.get(personaId);
    if (!limiter) limiters.set(personaId, (limiter = I.rateLimiter()));
    const allowed = limiter.address(deps.remoteAddress(conn), now());
    conn.on('data', async (chunk) => {
      if (done) return;
      let frames;
      try {
        frames = reader.push(chunk);
      } catch {
        return end(); // too large: drop it without decrypting
      }
      if (!frames.length) return;
      done = true;
      if (allowed) {
        try {
          await receiveFrame(personaId, frames[0], limiter);
        } catch (e) {
          log.warn('Inbox could not take a message', { error: String(e) });
        }
      }
      // The same answer for every outcome (§6.4).
      try {
        conn.write(I.lengthPrefix(I.ACK));
      } catch {}
      end();
    });
  }

  async function receiveFrame(personaId, frame, limiter) {
    const entry = servers.get(personaId);
    const p = personaById(personaId);
    if (!entry || !p) return;
    const rec = entry.rec;
    const sealed = I.decodeFrame(frame);
    const boxes = I.liveSeeds(rec, now()).map((s) => keysOf(rec, s).box);
    const opened = I.openSealed(sealed, boxes, crypto);
    if (!opened) return;
    await take(p, rec, opened, limiter);
  }

  // A Message that opened and whose signature checks out against the key inside it.
  async function take(p, rec, opened, limiter = null) {
    const { message, sign, replyTo } = opened;
    if (message.to !== p.profileUrl) return 'drop';
    const ck = convKey(p.profileUrl, message.from);
    const path = I.messagePath(p.id, ck, message);
    if (await store.read(path).catch(() => null)) return 'duplicate';
    const contact = await contactOf(p.id, message.from);
    const thread = await store.list(I.messagesPrefix(p.id, ck)).catch(() => []);
    const pendingFromSender = thread.some(
      (r) => I.isRecord(r) && r.direction === 'in' && r.request
    );
    let decision = I.classify({ contact, mode: rec.mode, sign, pendingFromSender });
    // A contact whose key we haven't seen yet: check it against their profile like a request.
    if (decision === 'inbox' && !contact?.sign) decision = 'check';
    if (decision === 'request' && limiter && !limiter.stranger(now())) decision = 'drop';
    if (decision === 'drop') return 'drop';
    const at = new Date(now()).toISOString();
    const record = I.makeRecord({
      personaId: p.id,
      direction: 'in',
      message,
      status: 'received',
      receivedAt: at,
      sign,
      ...(replyTo ? { replyTo } : {}),
      ...(decision === 'request' ? { request: true } : {}),
      ...(decision === 'inbox' ? {} : { verified: false }),
    });
    await store.put(path, record);
    if (decision === 'inbox') {
      if (replyTo)
        await putContact(p.id, message.from, { state: 'accepted', replyTo }).catch(() => {});
      notify(p, ck, record);
    } else {
      verify(path).catch(() => {});
    }
    if (decision === 'request') await pruneRequests(p.id).catch(() => {});
    changed();
    return decision;
  }

  // §6.3: the sender's Profile Drive must publish the sign key the Message was signed with.
  async function verify(path) {
    lastCheck.set(path, now());
    const rec = await store.read(path).catch(() => null);
    if (!I.isRecord(rec) || rec.verified !== false) return;
    if (I.uncheckedExpired(rec, now())) {
      await store.del(path).catch(() => {});
      changed();
      return;
    }
    const manifest = await profile(rec.message.from, true);
    const published = manifest?.inbox?.sign;
    if (!published) return; // not readable yet; try again later
    if (published !== rec.sign) {
      await store.del(path).catch(() => {});
      changed();
      return;
    }
    const next = { ...rec, verified: true };
    if (manifest?.title) next.fromTitle = String(manifest.title).slice(0, 280);
    await store.put(path, next);
    if (!rec.request) {
      const contact = await contactOf(rec.personaId, rec.message.from);
      if (contact?.state === 'accepted') {
        await putContact(rec.personaId, rec.message.from, {
          state: 'accepted',
          sign: rec.sign,
          replyTo: rec.replyTo,
        });
        const p = personaById(rec.personaId);
        const parsed = I.parseMessagePath(path);
        if (p && parsed) notify(p, parsed.conversationKey, next);
      }
    }
    changed();
  }

  async function pruneRequests(personaId) {
    const recs = await store.list(I.messagesPrefix(personaId)).catch(() => []);
    const requests = recs.filter((r) => I.isRecord(r) && r.direction === 'in' && r.request);
    for (const r of I.requestsToPrune(requests)) {
      await store
        .del(I.messagePath(personaId, convKey(r.message.to, r.message.from), r.message))
        .catch(() => {});
    }
  }

  function notify(p, conversationKey, record) {
    if (!deps.notify) return;
    const from = record.message.from;
    const cached = profiles.get(from)?.manifest;
    const title = record.fromTitle || cached?.title || I.shortKey(from);
    try {
      deps.notify({
        personaId: p.id,
        personaLabel: p.label,
        conversationKey,
        from,
        title: String(title),
        text: I.messagePreview(record.message),
      });
    } catch {}
  }

  // Sending (§4)
  // =

  // Make the Persona's inbox seed if it has none (sending turns it on for Contacts, §3.3).
  /** @param {string} personaId @param {{ mode?: string, sent?: boolean }} [o] */
  async function ensureInbox(personaId, { mode, sent = false } = {}) {
    const p = personaById(personaId);
    if (!p) throw new Error('That Persona is gone');
    if (!p.usable)
      throw new Error(
        'This Persona’s profile drive has a writer that isn’t one of your devices, so it can’t send or receive messages.'
      );
    let rec = await inboxOf(personaId);
    const at = new Date(now()).toISOString();
    if (!rec) rec = I.makeInbox({ personaId, seed: deps.randomBytes(32), mode: mode || 'off' }, at);
    else if (mode) rec = I.setMode(rec, mode, at);
    if (sent) rec = I.markSent(rec, at);
    await store.put(I.inboxPath(personaId), rec);
    return rec;
  }

  // Where to deliver to someone: their latest reply address, else what their profile publishes.
  async function addressOf(personaId, to) {
    const contact = await contactOf(personaId, to);
    if (contact?.replyTo) return contact.replyTo;
    const manifest = await profile(to, true);
    return I.normalizeReplyTo(manifest?.inbox);
  }

  // `vouch`: a Vouch this Persona gives the recipient (ADR-0045 §3.2), carried in the Message.
  async function send({ personaId, to, text, inReplyTo, replyTo = null, vouch = undefined }) {
    const p = personaById(personaId);
    if (!p) throw new Error('That Persona is gone');
    const toUrl = I.profileUrlOf(to);
    if (toUrl === p.profileUrl) throw new Error('That’s this Persona’s own profile');
    const contact = await contactOf(personaId, toUrl);
    if (contact?.state === 'blocked')
      throw new Error('You blocked this person. Unblock them first.');
    await ensureInbox(personaId, { sent: true });
    const at = new Date(now()).toISOString();
    const message = I.makeMessage(
      { id: I.newMessageId(deps.randomBytes(16)), from: p.profileUrl, to: toUrl, text, inReplyTo, vouch },
      at
    );
    // Writing to someone makes them a Contact for this Persona (§3.2).
    await putContact(personaId, toUrl, { state: 'accepted', ...(replyTo ? { replyTo } : {}) });
    const ck = convKey(p.profileUrl, toUrl);
    const record = I.makeRecord({
      personaId,
      direction: 'out',
      message,
      status: 'queued',
      attempts: 0,
    });
    const path = I.messagePath(personaId, ck, message);
    await store.put(path, record);
    // Accepting by replying: a request from them in this Conversation moves to the inbox.
    await acceptThread(personaId, ck);
    changed();
    schedule()
      .then(() => deliver(path))
      .catch(() => {});
    return { conversationKey: ck, record };
  }

  async function deliver(path) {
    if (delivering.has(path) || closed) return false;
    delivering.add(path);
    try {
      const rec = await store.read(path).catch(() => null);
      if (!I.isRecord(rec) || !I.outboxDue(rec, now())) return false;
      const ok = await attempt(rec).catch((e) => {
        log.warn('Inbox delivery failed', { error: String(e) });
        return false;
      });
      const latest = await store.read(path).catch(() => null);
      if (!I.isRecord(latest) || latest.status !== 'queued') return ok; // another Device got there
      await store.put(path, I.afterAttempt(latest, ok, now()));
      changed();
      return ok;
    } finally {
      delivering.delete(path);
    }
  }

  async function attempt(rec) {
    const p = personaById(rec.personaId);
    const inbox = await inboxOf(rec.personaId);
    if (!p || !p.usable || !inbox) return false;
    if (status.get(p.id)?.state === 'changed') return false;
    const target = await addressOf(rec.personaId, rec.message.to);
    if (!target) return false;
    const keys = keysOf(inbox);
    const pub = I.publicKeys(keys);
    const sealed = I.sealMessage(
      {
        message: rec.message,
        sign: keys.sign,
        recipientBox: target.box,
        replyTo: { box: pub.box, mailboxes: pub.mailboxes },
      },
      crypto
    );
    const frame = I.lengthPrefix(I.encodeFrame(sealed));
    for (const mailbox of target.mailboxes) {
      if (await sendTo(mailbox, frame)) return true;
    }
    return false;
  }

  function sendTo(mailboxHex, frame) {
    return new Promise((resolve) => {
      let conn;
      let settled = false;
      const reader = I.frameReader(16);
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        try {
          conn?.destroy();
        } catch {}
        resolve(ok);
      };
      const t = setTimeout(() => finish(false), ACK_TIMEOUT);
      try {
        conn = deps.connect(I.fromHex(mailboxHex));
      } catch {
        return finish(false);
      }
      conn.on('error', () => finish(false));
      conn.on('close', () => finish(false));
      conn.on('data', (chunk) => {
        try {
          const frames = reader.push(chunk);
          if (frames.length) finish(I.isAck(frames[0]));
        } catch {
          finish(false);
        }
      });
      try {
        conn.write(frame);
      } catch {
        finish(false);
      }
    });
  }

  async function tick() {
    if (closed || !deps.vaultReady()) return;
    const paths = await store.listPaths(I.MESSAGES_PREFIX).catch(() => []);
    for (const path of paths) {
      if (closed) return;
      if (!I.parseMessagePath(path)) continue;
      const rec = await store.read(path).catch(() => null);
      if (!I.isRecord(rec)) continue;
      if (I.outboxDue(rec, now())) await deliver(path);
      else if (rec.verified === false && now() - (lastCheck.get(path) || 0) > RECHECK_MS)
        await verify(path).catch(() => {});
    }
  }

  // Requests (§3.4)
  // =

  async function acceptThread(personaId, ck) {
    const recs = await store.list(I.messagesPrefix(personaId, ck)).catch(() => []);
    for (const r of recs) {
      if (!I.isRecord(r) || !r.request) continue;
      const { request: _r, ...rest } = r;
      await store.put(I.messagePath(personaId, ck, r.message), rest);
    }
  }

  async function accept(personaId, profileUrl) {
    const url = I.profileUrlOf(profileUrl);
    const p = personaById(personaId);
    if (!p) throw new Error('That Persona is gone');
    const ck = convKey(p.profileUrl, url);
    const recs = await store.list(I.messagesPrefix(personaId, ck)).catch(() => []);
    const latest = I.sortThread(recs)
      .reverse()
      .find((r) => r.direction === 'in');
    await putContact(personaId, url, {
      state: 'accepted',
      ...(latest?.verified !== false && latest?.sign ? { sign: latest.sign } : {}),
      ...(latest?.replyTo ? { replyTo: latest.replyTo } : {}),
    });
    await acceptThread(personaId, ck);
    changed();
  }

  // Ignore deletes the request; the sender can ask again (§3.4).
  async function ignore(personaId, profileUrl) {
    const url = I.profileUrlOf(profileUrl);
    const p = personaById(personaId);
    if (!p) throw new Error('That Persona is gone');
    await removeThread(personaId, convKey(p.profileUrl, url));
    changed();
  }

  async function block(personaId, profileUrl) {
    const url = I.profileUrlOf(profileUrl);
    const p = personaById(personaId);
    if (!p) throw new Error('That Persona is gone');
    const ck = convKey(p.profileUrl, url);
    const recs = await store.list(I.messagesPrefix(personaId, ck)).catch(() => []);
    const latest = I.sortThread(recs)
      .reverse()
      .find((r) => r.direction === 'in' && r.sign);
    await putContact(personaId, url, {
      state: 'blocked',
      ...(latest ? { sign: latest.sign } : {}),
    });
    // A blocked request goes; a Conversation with a Contact stays for the user to delete.
    for (const r of recs)
      if (I.isRecord(r) && r.request) await store.del(I.messagePath(personaId, ck, r.message));
    changed();
  }

  async function unblock(personaId, profileUrl) {
    const url = I.profileUrlOf(profileUrl);
    const path = I.contactPath(personaId, profileHash(url));
    if (await store.read(path).catch(() => null)) await store.del(path);
    changed();
  }

  async function removeThread(personaId, ck) {
    for (const path of await store.listPaths(I.messagesPrefix(personaId, ck)).catch(() => []))
      await store.del(path).catch(() => {});
  }

  async function deleteConversation(personaId, profileUrl) {
    const p = personaById(personaId);
    if (!p) throw new Error('That Persona is gone');
    await removeThread(personaId, convKey(p.profileUrl, I.profileUrlOf(profileUrl)));
    changed();
  }

  async function markRead(personaId, profileUrl) {
    const p = personaById(personaId);
    if (!p) return;
    const ck = convKey(p.profileUrl, I.profileUrlOf(profileUrl));
    const at = new Date(now()).toISOString();
    let any = false;
    for (const r of await store.list(I.messagesPrefix(personaId, ck)).catch(() => [])) {
      if (!I.isRecord(r) || r.direction !== 'in' || r.readAt) continue;
      await store.put(I.messagePath(personaId, ck, r.message), { ...r, readAt: at });
      any = true;
    }
    if (any) changed();
  }

  async function retry(personaId, profileUrl, id) {
    const p = personaById(personaId);
    if (!p) return;
    const ck = convKey(p.profileUrl, I.profileUrlOf(profileUrl));
    for (const path of await store.listPaths(I.messagesPrefix(personaId, ck)).catch(() => [])) {
      const parsed = I.parseMessagePath(path);
      if (!parsed || (id && parsed.id !== id)) continue;
      const r = await store.read(path).catch(() => null);
      if (!I.isRecord(r) || r.direction !== 'out' || r.status === 'delivered') continue;
      await store.put(path, I.retryNow(r));
      deliver(path).catch(() => {});
    }
    changed();
  }

  // Settings (§2, §3)
  // =

  async function setInboxMode(personaId, mode) {
    await ensureInbox(personaId, { mode: I.normalizeMode(mode) });
    await schedule();
  }

  async function rotate(personaId) {
    const rec = await inboxOf(personaId);
    if (!rec) throw new Error('This Persona has no inbox yet');
    await store.put(
      I.inboxPath(personaId),
      I.rotateInbox(rec, deps.randomBytes(32), new Date(now()).toISOString())
    );
    await schedule();
  }

  // The message link for a Persona (§3.1), or null when it has no inbox.
  async function linkFor(personaId) {
    const p = personaById(personaId);
    const rec = await inboxOf(personaId);
    if (!p || !rec) return null;
    const pub = I.publicKeys(keysOf(rec));
    return I.messageLink({ profileUrl: p.profileUrl, box: pub.box, mailboxes: pub.mailboxes });
  }

  // Deleting a Persona: its seed, Contacts and Messages, and the inbox in its profile (§7.4).
  async function forgetPersona(personaId) {
    const s = servers.get(personaId);
    if (s) {
      servers.delete(personaId);
      await s.close().catch(() => {});
    }
    await deps.writeProfileInbox(personaId, null).catch(() => false);
    for (const prefix of [I.messagesPrefix(personaId), I.contactsPrefix(personaId)])
      for (const path of await store.listPaths(prefix).catch(() => []))
        await store.del(path).catch(() => {});
    if (await store.read(I.inboxPath(personaId)).catch(() => null))
      await store.del(I.inboxPath(personaId)).catch(() => {});
    status.delete(personaId);
    changed();
  }

  // Reads for the UI
  // =

  async function personaState(p) {
    const rec = await inboxOf(p.id);
    const st = status.get(p.id) || { state: rec ? 'not-ready' : 'off', reason: '' };
    return {
      personaId: p.id,
      label: p.label,
      profileUrl: p.profileUrl,
      usable: !!p.usable,
      enabled: !!rec,
      mode: rec?.mode || 'off',
      sent: !!rec?.sent,
      rotatedAt: rec?.rotatedAt || null,
      state: st.state,
      reason: st.reason,
    };
  }

  async function summary() {
    const personas = await Promise.all(deps.personas().map(personaState));
    const recs = await store.list(I.MESSAGES_PREFIX).catch(() => []);
    const visible = recs.filter((r) => I.isRecord(r) && !(r.request && r.verified === false));
    const convs = I.conversations(visible).map((c) => ({
      ...c,
      conversationKey: convKey(
        personas.find((p) => p.personaId === c.personaId)?.profileUrl || c.other,
        c.other
      ),
      title: profiles.get(c.other)?.manifest?.title || c.last.fromTitle || '',
    }));
    const contacts = (await store.list(I.CONTACTS_PREFIX).catch(() => [])).filter(I.isContact);
    for (const c of convs) {
      const contact = contacts.find((k) => k.personaId === c.personaId && k.profileUrl === c.other);
      c.contact = contact?.state || null;
    }
    return {
      vaultReady: deps.vaultReady(),
      personas,
      conversations: convs.filter((c) => !c.request),
      requests: convs.filter((c) => c.request),
      blocked: contacts
        .filter((c) => c.state === 'blocked')
        .map((c) => ({ personaId: c.personaId, profileUrl: c.profileUrl })),
    };
  }

  async function thread(personaId, profileUrl) {
    const p = personaById(personaId);
    if (!p) throw new Error('That Persona is gone');
    const other = I.profileUrlOf(profileUrl);
    const ck = convKey(p.profileUrl, other);
    const recs = I.sortThread(await store.list(I.messagesPrefix(personaId, ck)).catch(() => []));
    const contact = await contactOf(personaId, other);
    const manifest = await profile(other).catch(() => null);
    return {
      personaId,
      conversationKey: ck,
      other,
      title: manifest?.title ? String(manifest.title) : '',
      thumb: typeof manifest?.thumb === 'string' ? manifest.thumb : '',
      contact: contact?.state || null,
      reachable: !!(contact?.replyTo || I.normalizeReplyTo(manifest?.inbox)),
      records: recs.filter((r) => !(r.request && r.verified === false)),
    };
  }

  // Look up a profile for a new Conversation: its title, and whether it can be written to.
  async function lookup(profileUrl) {
    const url = I.profileUrlOf(profileUrl);
    const manifest = await profile(url, true);
    return {
      profileUrl: url,
      title: manifest?.title ? String(manifest.title) : '',
      thumb: typeof manifest?.thumb === 'string' ? manifest.thumb : '',
      isPerson: manifest?.type === 'walled.garden/person',
      published: !!I.normalizeReplyTo(manifest?.inbox),
    };
  }

  // Lifecycle
  // =

  function start() {
    closed = false;
    schedule().catch(() => {});
    const loop = () => {
      if (closed) return;
      tick()
        .catch(() => {})
        .finally(() => {
          if (!closed) timer = setTimeout(loop, TICK_MS);
        });
    };
    timer = setTimeout(loop, 1000);
  }

  // Suspend (the phone leaving the screen) or quit: unannounce every mailbox.
  async function close() {
    closed = true;
    clearTimeout(timer);
    for (const [id, s] of servers) {
      servers.delete(id);
      await s.close().catch(() => {});
    }
  }

  // Something to check again now: the Vault changed, a Persona changed, the network came back.
  function poke() {
    schedule().catch(() => {});
  }

  function flush() {
    return tick();
  }

  return {
    start,
    close,
    poke,
    flush,
    reconcile: schedule,
    send,
    accept,
    ignore,
    block,
    unblock,
    deleteConversation,
    markRead,
    retry,
    setMode: setInboxMode,
    rotate,
    linkFor,
    forgetPersona,
    summary,
    thread,
    lookup,
    statusOf: (id) => status.get(id) || null,
    listening: () => [...servers.keys()],
    _take: take,
  };
}

// listen / connect / remoteAddress for createInboxEngine over a HyperDHT node (swarm.dht). `DHT` is
// the hyperdht class (for fresh key pairs) and `b4a` turns Uint8Arrays into the Buffers it wants.
export function dhtTransport(dht, DHT, b4a) {
  const buf = (u) => b4a.from(u.buffer, u.byteOffset, u.byteLength);
  return {
    async listen(keyPair, onConnection) {
      const server = dht.createServer(onConnection);
      await server.listen({ publicKey: buf(keyPair.publicKey), secretKey: buf(keyPair.secretKey) });
      return { close: () => server.close() };
    },
    // A fresh key pair for every delivery, never the swarm's (§4).
    connect(publicKey) {
      return dht.connect(buf(publicKey), { keyPair: DHT.keyPair() });
    },
    remoteAddress(conn) {
      return conn?.rawStream?.remoteHost || '?';
    },
  };
}
