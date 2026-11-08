// nomad/shared/vouch-engine.mjs
//
// Vouches' moving parts (ADR-0045), shared by desktop (bg/ui/vouches.js) and the phone
// (mobile/backend/lib/vouches.mjs): giving, renewing and withdrawing (the host's Vault records and
// the hash list in their Profile Drive), taking Vouches in from Messages, accepting, declining and
// showing them (the guest's Vault records and the list on their profile), checking any Vouch
// against its host's drive, and the guard that notices a hash none of the user's Devices wrote.
// The rules are shared/vouches.mjs; delivery is the Persona Inbox (shared/inbox-engine.mjs).
//
// No imports beyond the rules. Everything that touches the runtime comes in `deps`:
//
//   store                      the Vault's app records:
//     read(path) / list(prefix) / listPaths(prefix) / put(path, obj) / del(path)
//   sha256hex(string)          -> hex
//   randomBytes(n)             -> Uint8Array
//   personas()                 -> [{ id, label, profileUrl, usable }]
//   readProfileFile(url, path) -> Promise<{ value: any | null } | null>
//                                 null: the drive couldn't be read now; { value: null }: no file
//   writeProfileFile(personaId, path, obj | null) -> Promise<bool>
//                                 null removes the file; false when this Device can't write it yet
//   send({ personaId, to, vouch, replyTo? }) -> Promise   the Inbox's send (shared/inbox-engine.mjs)
//   reachable(personaId, profileUrl) -> Promise<bool>    can the Inbox deliver there now?
//   known()                    -> Promise<[profile key or URL]>  people the viewer knows (§6)
//   onForeign?({ personaId, label, hash })  a hash none of the user's Devices wrote (§4)
//   onChange?()
//   now?()                     -> ms

import * as V from './vouches.mjs';
import * as I from './inbox.mjs';

const CHECK_TTL = 60 * 1000;
const MANIFEST_TTL = 5 * 60 * 1000;
// A hash this Device didn't write may be one another Device wrote whose Vault record hasn't
// arrived yet. Only one still unknown after this long is reported.
const FOREIGN_GRACE_MS = 10 * 60 * 1000;
const PARALLEL = 6;

const CANT_WRITE =
  'This device can’t change that profile yet. Keep the device that made it online for a minute so it can add this one, then try again.';

export function createVouchEngine(deps) {
  const { store } = deps;
  const now = deps.now || (() => Date.now());
  const hash = (v) => V.vouchHash(v, deps.sha256hex);
  const changed = () => {
    try {
      deps.onChange?.();
    } catch {}
  };

  const indexes = new Map(); // host profile URL -> { at, hashes | null }
  const manifests = new Map(); // profile URL -> { at, manifest | null }
  const unknownSince = new Map(); // `${personaId}:${hash}` -> ms first seen
  const reported = new Set();
  let held = []; // [{ path, personaId, rec }]
  let given = [];
  let foreign = []; // [{ personaId, hash, since }]
  /** @type {Promise<any>} */
  let writes = Promise.resolve();

  function serial(fn) {
    const run = writes.then(fn);
    writes = run.catch(() => {});
    return run;
  }

  const personaById = (id) => deps.personas().find((p) => p.id === id) || null;

  function needPersona(id, { usable = false } = {}) {
    const p = personaById(id);
    if (!p) throw new Error('That Persona is gone');
    if (usable && !p.usable)
      throw new Error(
        'This Persona’s profile drive has a writer that isn’t one of your devices, so it can’t give vouches.'
      );
    return p;
  }

  // Records
  // =

  // Records don't name their Persona: it's in the path.
  async function readAll(prefix) {
    const paths = await store.listPaths(prefix).catch(() => []);
    const out = [];
    for (const path of paths) {
      const parsed = V.parseRecordPath(path);
      if (!parsed) continue;
      const rec = await store.read(path).catch(() => null);
      if (rec?.vouch?.id === parsed.id) out.push({ path, personaId: parsed.personaId, rec });
    }
    return out;
  }

  async function refresh() {
    const ids = new Set(deps.personas().map((p) => p.id));
    const [h, g] = await Promise.all([readAll(V.HELD_PREFIX), readAll(V.GIVEN_PREFIX)]);
    held = h.filter((x) => V.isHeld(x.rec) && ids.has(x.personaId));
    given = g.filter((x) => V.isGiven(x.rec) && ids.has(x.personaId));
  }

  const heldOf = (pid) => held.filter((x) => x.personaId === pid).map((x) => x.rec);
  const givenOf = (pid) => given.filter((x) => x.personaId === pid).map((x) => x.rec);

  // The host's list and the guest's profile list
  // =

  async function publishIndex(personaId) {
    const hashes = V.standingHashes(givenOf(personaId), deps.sha256hex, now());
    const ok = await deps.writeProfileFile(personaId, V.INDEX_PATH, V.makeIndex(hashes));
    if (!ok) throw new Error(CANT_WRITE);
    const p = personaById(personaId);
    if (p) indexes.set(p.profileUrl, { at: now(), hashes: V.makeIndex(hashes).hashes });
  }

  async function publishProfile(personaId) {
    const items = V.profileVouches(heldOf(personaId), now());
    const ok = await deps.writeProfileFile(personaId, V.PROFILE_PATH, items.length ? V.makeShownList(items) : null);
    if (!ok) throw new Error(CANT_WRITE);
  }

  // Reading other drives
  // =

  async function indexOf(hostUrl, { fresh = false } = {}) {
    const c = indexes.get(hostUrl);
    if (c && !fresh && now() - c.at < CHECK_TTL) return c.hashes;
    const res = await deps.readProfileFile(hostUrl, V.INDEX_PATH).catch(() => null);
    const hashes = res ? (res.value == null ? [] : V.indexHashes(res.value)) : null;
    indexes.set(hostUrl, { at: now(), hashes });
    return hashes;
  }

  async function manifestOf(url) {
    const c = manifests.get(url);
    if (c && now() - c.at < MANIFEST_TTL) return c.manifest;
    const res = await deps.readProfileFile(url, '/index.json').catch(() => null);
    const manifest = res?.value && typeof res.value === 'object' ? res.value : null;
    if (manifest || !c) manifests.set(url, { at: now(), manifest });
    return manifest || c?.manifest || null;
  }

  async function check(vouch, opts) {
    return V.verifyVouch(vouch, await indexOf(vouch.host, opts), now(), deps.sha256hex);
  }

  async function mapLimit(list, fn) {
    const out = Array.from({ length: list.length });
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const n = i++;
        out[n] = await fn(list[n]).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker));
    return out;
  }

  async function who(url) {
    const m = await manifestOf(url);
    return {
      title: m?.title ? String(m.title).slice(0, 280) : '',
      thumb: typeof m?.thumb === 'string' ? m.thumb : '',
      isPerson: m?.type === 'walled.garden/person',
    };
  }

  // Taking Vouches in (§3.4)
  // =

  // Every received Message that carries a Vouch for one of the user's Personas, once: a new held
  // record (or a renewal of one held), and a mark on the Message so a declined or removed Vouch
  // stays gone. Runs whenever the Vault changes, on any of the user's Devices.
  function intake() {
    return serial(async () => {
      const personas = deps.personas();
      if (!personas.length) return 0;
      const recs = await store.list(I.MESSAGES_PREFIX).catch(() => []);
      let n = 0;
      const touched = new Set();
      for (const rec of recs) {
        if (!rec?.message?.vouch || rec.direction !== 'in') continue;
        const got = V.vouchFromMessage(rec, personas);
        if (!got) continue;
        const mark = V.intakeMark(got.vouch);
        if (rec.vouchSeen === mark) continue;
        // Where the Inbox keeps it (shared/inbox.mjs messagePath).
        const ck = deps.sha256hex(I.conversationKeyInput(rec.message.to, rec.message.from));
        const path = I.messagePath(rec.personaId, ck, rec.message);
        const hp = V.heldPath(got.personaId, got.vouch.id);
        const prev = await store.read(hp).catch(() => null);
        const next = V.mergeIncoming(prev, got.vouch, now());
        if (next) {
          await store.put(hp, next);
          n++;
          if (prev && next.shown === 'profile') touched.add(got.personaId);
        }
        await store.put(path, { ...rec, vouchSeen: mark });
      }
      if (n) {
        await refresh();
        for (const pid of touched) await publishProfile(pid).catch(() => {});
        changed();
      }
      return n;
    });
  }

  // The guard (§4)
  // =

  // For each Persona: the hashes in its Profile Drive that no record of the user's says it gave.
  // A withdrawn or expired hash that is still listed is taken out (another Device withdrew it and
  // couldn't write the drive). Reports a foreign one once, after FOREIGN_GRACE_MS.
  async function guard() {
    const out = [];
    for (const p of deps.personas()) {
      if (!p.usable) continue;
      const listed = await indexOf(p.profileUrl, { fresh: true });
      if (!listed) continue;
      const mine = givenOf(p.id);
      const standing = new Set(V.standingHashes(mine, deps.sha256hex, now()));
      const extra = V.foreignHashes(listed, mine, deps.sha256hex);
      const stale = listed.filter((h) => !standing.has(h) && !extra.includes(h));
      if (stale.length || [...standing].some((h) => !listed.includes(h)))
        await serial(() => publishIndex(p.id)).catch(() => {});
      for (const h of extra) {
        const k = `${p.id}:${h}`;
        const since = unknownSince.get(k) ?? now();
        unknownSince.set(k, since);
        if (now() - since < FOREIGN_GRACE_MS) continue;
        out.push({ personaId: p.id, label: p.label, hash: h, since: new Date(since).toISOString() });
        if (!reported.has(k)) {
          reported.add(k);
          try {
            deps.onForeign?.({ personaId: p.id, label: p.label, hash: h });
          } catch {}
        }
      }
      for (const k of unknownSince.keys())
        if (k.startsWith(`${p.id}:`) && !extra.includes(k.slice(p.id.length + 1))) unknownSince.delete(k);
    }
    const before = JSON.stringify(foreign);
    foreign = out;
    if (JSON.stringify(foreign) !== before) changed();
    return out;
  }

  // Giving (§3)
  // =

  // Can this Persona give `to` a Vouch now? { ok, reason, title, thumb } for the form.
  async function preview({ personaId, to, replyTo = null }) {
    const toUrl = V.profileUrlOf(to);
    const p = personaId ? personaById(personaId) : null;
    const w = await who(toUrl);
    let reason = '';
    if (!w.isPerson) reason = 'That drive isn’t a profile.';
    else if (p && V.profileKeyOf(p.profileUrl) === V.profileKeyOf(toUrl))
      reason = 'That’s this Persona’s own profile.';
    else if (deps.personas().some((x) => V.profileKeyOf(x.profileUrl) === V.profileKeyOf(toUrl)))
      reason = 'That’s one of your own Personas.';
    else if (p && !p.usable)
      reason = 'This Persona’s profile drive has a writer that isn’t one of your devices.';
    else if (p && givenOf(p.id).some((r) => r.vouch.guest === toUrl && !r.withdrawnAt && !V.isExpired(r.vouch, now())))
      reason = 'You already vouched for them with this Persona. Renew it from your vouches when it’s due.';
    else if (p && !replyTo && !(await deps.reachable(p.id, toUrl).catch(() => false)))
      reason = `${w.title || 'They'} ${w.title ? 'isn’t' : 'aren’t'} taking messages. Ask them for a message link.`;
    return { profileUrl: toUrl, ok: !reason, reason, title: w.title, thumb: w.thumb };
  }

  function give({ personaId, to, note, replyTo = null }) {
    return serial(async () => {
      const p = needPersona(personaId, { usable: true });
      const pre = await preview({ personaId, to, replyTo });
      if (!pre.ok) throw new Error(pre.reason);
      const vouch = V.makeVouch(
        { id: V.newVouchId(deps.randomBytes(16)), host: p.profileUrl, guest: pre.profileUrl, note },
        now()
      );
      const path = V.givenPath(p.id, vouch.id);
      await store.put(path, V.makeGiven(vouch, null, now()));
      await refresh();
      try {
        await publishIndex(p.id);
      } catch (e) {
        // Nothing went out: forget it.
        await store.del(path).catch(() => {});
        await refresh();
        throw e;
      }
      await deps.send({ personaId: p.id, to: pre.profileUrl, vouch, replyTo });
      changed();
      return vouch;
    });
  }

  function renew(personaId, id) {
    return serial(async () => {
      const p = needPersona(personaId, { usable: true });
      const path = V.givenPath(p.id, id);
      const prev = await store.read(path);
      if (!V.isGiven(prev) || prev.withdrawnAt) throw new Error('That vouch is gone');
      const vouch = V.renewVouch(prev.vouch, now());
      await store.put(path, V.makeGiven(vouch, prev, now()));
      await refresh();
      try {
        await publishIndex(p.id);
      } catch (e) {
        await store.put(path, prev).catch(() => {});
        await refresh();
        throw e;
      }
      await deps.send({ personaId: p.id, to: vouch.guest, vouch });
      changed();
      return vouch;
    });
  }

  // Quiet (§7): nothing is sent. The guest's list shows it as no longer valid next time it checks.
  function withdraw(personaId, id) {
    return serial(async () => {
      const p = needPersona(personaId);
      const path = V.givenPath(p.id, id);
      const prev = await store.read(path);
      if (!V.isGiven(prev)) throw new Error('That vouch is gone');
      if (!prev.withdrawnAt) await store.put(path, V.withdrawGiven(prev, now()));
      await refresh();
      // Another Device puts the list right if this one can't write the drive (guard()).
      await publishIndex(p.id).catch(() => {});
      changed();
    });
  }

  // A withdrawn or expired Vouch the host no longer wants to see.
  function forgetGiven(personaId, id) {
    return serial(async () => {
      const path = V.givenPath(personaId, id);
      const prev = await store.read(path);
      if (V.isGiven(prev) && !prev.withdrawnAt && !V.isExpired(prev.vouch, now()))
        throw new Error('Withdraw the vouch first');
      if (prev) await store.del(path);
      await refresh();
      changed();
    });
  }

  // Holding (§3.4, §5)
  // =

  function accept(personaId, id) {
    return serial(async () => {
      const path = V.heldPath(personaId, id);
      const prev = await store.read(path);
      if (!V.isHeld(prev)) throw new Error('That vouch is gone');
      if (prev.state !== 'accepted') await store.put(path, V.acceptHeld(prev, now()));
      await refresh();
      changed();
    });
  }

  // Decline and remove both delete it; neither is sent to the host.
  function decline(personaId, id) {
    return serial(async () => {
      const path = V.heldPath(personaId, id);
      const prev = await store.read(path);
      if (prev) await store.del(path);
      await refresh();
      if (prev?.shown === 'profile') await publishProfile(personaId).catch(() => {});
      changed();
    });
  }

  function setShown(personaId, id, shown) {
    return serial(async () => {
      const path = V.heldPath(personaId, id);
      const prev = await store.read(path);
      if (!V.isHeld(prev)) throw new Error('That vouch is gone');
      const next = V.setShown(prev, shown);
      if (next.shown === prev.shown) return;
      await store.put(path, next);
      await refresh();
      if (prev.shown === 'profile' || next.shown === 'profile') {
        try {
          await publishProfile(personaId);
        } catch (e) {
          await store.put(path, prev).catch(() => {});
          await refresh();
          throw e;
        }
      }
      changed();
    });
  }

  // Deleting a Persona (§7): withdraw everything it gave, delete what it held, and take its list
  // off its profile.
  function forgetPersona(personaId) {
    return serial(async () => {
      await deps.writeProfileFile(personaId, V.INDEX_PATH, V.makeIndex([])).catch(() => false);
      await deps.writeProfileFile(personaId, V.PROFILE_PATH, null).catch(() => false);
      for (const prefix of [V.givenPrefix(personaId), V.heldPrefix(personaId)])
        for (const path of await store.listPaths(prefix).catch(() => []))
          await store.del(path).catch(() => {});
      await refresh();
      changed();
    });
  }

  // Reads for the UI
  // =

  // My Library → Personas → Vouches. With `check`, each Vouch is checked against its host's drive
  // (cached for a minute).
  async function summary({ check: doCheck = true } = {}) {
    await refresh();
    const t = now();
    const heldRows = await mapLimit(V.sortHeld(held.map((x) => ({ ...x.rec, _pid: x.personaId }))), async (r) => {
      const w = await who(r.vouch.host);
      return {
        personaId: r._pid,
        id: r.vouch.id,
        vouch: r.vouch,
        state: r.state,
        shown: r.shown,
        receivedAt: r.receivedAt,
        acceptedAt: r.acceptedAt || null,
        host: { url: r.vouch.host, title: w.title, thumb: w.thumb },
        check: doCheck ? await check(r.vouch) : V.isExpired(r.vouch, t) ? 'expired' : null,
      };
    });
    const givenRows = await mapLimit(V.sortGiven(given.map((x) => ({ ...x.rec, _pid: x.personaId }))), async (r) => {
      const w = await who(r.vouch.guest);
      return {
        personaId: r._pid,
        id: r.vouch.id,
        vouch: r.vouch,
        createdAt: r.createdAt,
        withdrawnAt: r.withdrawnAt || null,
        expired: V.isExpired(r.vouch, t),
        renewDue: !r.withdrawnAt && V.renewDue(r.vouch, t),
        guest: { url: r.vouch.guest, title: w.title, thumb: w.thumb },
      };
    });
    return {
      personas: deps.personas().map((p) => ({ id: p.id, label: p.label, profileUrl: p.profileUrl, usable: !!p.usable })),
      held: heldRows.filter(Boolean),
      given: givenRows.filter(Boolean),
      foreign: [...foreign],
    };
  }

  // The Vouches a Profile Drive shows (§6): each checked, grouped by whether the viewer knows the
  // host. Never a total.
  async function profileVouches(url) {
    const profileUrl = V.profileUrlOf(url);
    const res = await deps.readProfileFile(profileUrl, V.PROFILE_PATH).catch(() => null);
    if (!res) return { profileUrl, readable: false, known: [], others: [] };
    const items = V.shownItems(res.value, profileUrl);
    const checked = await mapLimit(items, async (vouch) => {
      const state = await check(vouch);
      if (state !== 'valid' && state !== 'unreachable') return { vouch, state };
      const w = await who(vouch.host);
      return { vouch, state, host: { url: vouch.host, title: w.title, thumb: w.thumb } };
    });
    const known = await deps.known().catch(() => []);
    const own = deps.personas().map((p) => p.profileUrl);
    const groups = V.groupForViewer(checked.filter(Boolean), [...known, ...own]);
    return { profileUrl, readable: true, ...groups };
  }

  // For the login prompt: each Persona's accepted Vouches the user lets sites see.
  function loginChoices(personaId) {
    return V.sortHeld(heldOf(personaId))
      .filter((r) => r.state === 'accepted' && r.shown !== 'me' && !V.isExpired(r.vouch, now()))
      .map((r) => ({ id: r.vouch.id, host: r.vouch.host, note: r.vouch.note || '', issuedAt: r.vouch.issuedAt }));
  }

  // What a Session shows its site (sync: from the records last read).
  function sessionVouches(personaId, ids) {
    return V.sessionVouches(ids, heldOf(personaId), now());
  }

  async function hostTitles(urls) {
    const out = {};
    await mapLimit([...new Set(urls)], async (u) => {
      out[u] = (await who(u)).title;
    });
    return out;
  }

  return {
    refresh,
    intake,
    guard,
    preview,
    give,
    renew,
    withdraw,
    forgetGiven,
    accept,
    decline,
    remove: decline,
    setShown,
    forgetPersona,
    summary,
    profileVouches,
    loginChoices,
    sessionVouches,
    hostTitles,
    check,
    newCount: () => held.filter((x) => x.rec.state === 'new').length,
  };
}
