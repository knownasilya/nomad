// nomad/shared/note-live-spaces.mjs
//
// Live Notes between the people of a shared Space (ADR-0041, amendment 2). A Note kept in a shared
// Space (its Space Library, ADR-0029) is edited live by every member who has it open, not only by
// one person's Devices. Each shared Space this Device can write gets its own session hub
// (shared/note-live-hub.mjs) and its own link (shared/note-live.mjs), keyed on the Space Library's
// key instead of the Vault's:
//
//   a Note of the user's own ──────────── the Vault hub ─── nomad/note-live, id = Vault key
//   a Note in shared Space S ─────────── S's hub ───────── nomad/note-live, id = S's Library key
//
// On S's link each side proves it holds a writer key of S's Library that a current member who can
// edit has on their member record (`writers`), with the same signed challenge as the Vault link.
// So a removed member, a viewer, or anyone who once saw the Library key can't join, and the leader
// (the lowest key that can save) is picked from the same keys by everyone in the session, whoever's
// Device it is. The user's own Devices meet on S's link too, for S's Notes.
//
// Like the other shared modules it has no bare imports. Desktop (app/bg/notes/live-notes.js) and the
// phone's backend (mobile/backend/lib/live-notes.mjs) run it. Tested in
// tests/unit/note-live-spaces.test.js.

function noop(..._args) {}

/**
 * vault            the Device's own hub (createLiveNotes(...)), for every Note not in a shared Space
 * spaceOf(id, ctx) -> Promise<space | null>: the shared Space (Root Drive key) that keeps Note `id`,
 *                  when this Device can write its Library; null for the Vault hub
 * library(space)   -> Promise<lib | null>, lib = {
 *                    key        the Space Library's key (hex)
 *                    writerKey  this Device's writer key in it (hex)
 *                    sign(message) -> hex signature with that writer key
 *                    canSave()  whether this Device can write the Library now
 *                    editors()  -> Promise<Set<hex>>: the writer keys of the members who can edit
 *                  }
 * verifySig(key, message, sigHex) -> Promise<boolean>: signed by the signer of writer core `key`
 * makeLink(opts)   createNoteLink with the runtime's swarm, Protomux, c, b4a, randomHex bound
 * makeHub(space, lib) -> a createLiveNotes(...) whose records are Space `space`'s
 */
export function createLiveRouter({ vault, spaceOf, library, verifySig, makeLink, makeHub, log = noop }) {
  const scopes = new Map(); // space -> { space, lib, hub, link }
  const starting = new Map(); // space -> Promise<scope | null>
  const pages = new Map(); // connId -> hub

  async function startScope(space) {
    const lib = await library(space);
    if (!lib || !lib.key || !lib.writerKey) return null;
    const hub = makeHub(space, lib);
    const link = makeLink({
      getVaultKey: () => lib.key,
      getDeviceKey: () => lib.writerKey,
      sign: lib.sign,
      verify: async (key, message, sigHex) => {
        try {
          if (!(await lib.editors()).has(key)) return false;
          return !!(await verifySig(key, message, sigHex));
        } catch {
          return false;
        }
      },
      openIds: () => hub.openIds(),
      onPeer: (key, up) => hub.onPeer(key, up),
      onFrame: (key, f) => hub.onFrame(key, f).catch((err) => log('space note frame failed', err && err.message)),
      log,
    });
    hub.useLink(link);
    link.install();
    const scope = { space, lib, hub, link };
    scopes.set(space, scope);
    log('Live Notes joined a shared Space', space.slice(0, 8));
    return scope;
  }

  function scopeOf(space) {
    if (scopes.has(space)) return Promise.resolve(scopes.get(space));
    if (!starting.has(space)) {
      starting.set(
        space,
        startScope(space)
          .catch((err) => {
            log('space live notes failed', err && err.message);
            return null;
          })
          .finally(() => starting.delete(space))
      );
    }
    return starting.get(space);
  }

  function dropScope(scope) {
    scopes.delete(scope.space);
    scope.hub.closeAll();
    try {
      scope.link.reset();
    } catch {}
    for (const [conn, hub] of pages) if (hub === scope.hub) pages.delete(conn);
  }

  // The hub for Note `id`: its shared Space's, or the Vault's.
  async function hubFor(id, ctx) {
    const space = await spaceOf(id, ctx).catch(() => null);
    if (!space) return vault;
    const scope = await scopeOf(space);
    return scope ? scope.hub : vault;
  }

  // Keep a link open for each shared Space in `spaces` (their Root Drive keys), so a member who
  // opens one of its Notes finds the others who have it open, and close the rest.
  async function syncSpaces(spaces) {
    const want = new Set(spaces || []);
    for (const scope of [...scopes.values()]) if (!want.has(scope.space)) dropScope(scope);
    await Promise.all([...want].map((s) => scopeOf(s)));
  }

  // The swarm changed: open the links on its connections again.
  function install() {
    for (const scope of scopes.values()) scope.link.install();
  }

  async function openPage(id, connId, opts = {}) {
    const hub = await hubFor(id, opts.ctx || null);
    pages.set(connId, hub);
    try {
      return await hub.openPage(id, connId, opts);
    } catch (err) {
      pages.delete(connId);
      throw err;
    }
  }

  function pageReceive(id, connId, bytes) {
    const hub = pages.get(connId);
    return hub ? hub.pageReceive(id, connId, bytes) : false;
  }

  async function closePage(id, connId) {
    const hub = pages.get(connId);
    pages.delete(connId);
    if (hub) await hub.closePage(id, connId);
  }

  function isOpen(id) {
    if (vault.isOpen(id)) return true;
    for (const scope of scopes.values()) if (scope.hub.isOpen(id)) return true;
    return false;
  }

  // The AI types into Note `id` where it's open. Only the hub of the Note's own place is asked, so
  // another member listing an id in their OPEN can't steer the AI's write into a different Note.
  async function aiWrite(id, base, body, opts = {}) {
    const hub = await hubFor(id, opts.ctx || null);
    return hub.aiWrite(id, base, body, opts);
  }

  async function recordsChanged() {
    await Promise.all([vault.recordsChanged(), ...[...scopes.values()].map((s) => s.hub.recordsChanged())]);
  }

  // Everything closes (the Vault went away): the Vault hub's sessions and every Space's.
  function closeAll() {
    vault.closeAll();
    for (const scope of [...scopes.values()]) dropScope(scope);
    pages.clear();
  }

  function sessions() {
    let n = vault.sessions();
    for (const scope of scopes.values()) n += scope.hub.sessions();
    return n;
  }

  return {
    syncSpaces,
    install,
    openPage,
    pageReceive,
    closePage,
    isOpen,
    aiWrite,
    recordsChanged,
    closeAll,
    sessions,
    // For tests and status pages.
    spaces: () => [...scopes.keys()],
    hubOf: (space) => scopes.get(space)?.hub || null,
  };
}

// The writer keys of the members of a Space who can edit, from its member records.
export function editorKeys(members, canEdit) {
  const out = new Set();
  for (const m of members || []) {
    if (!m || !canEdit(m.role)) continue;
    for (const k of m.writers || []) if (typeof k === 'string' && /^[0-9a-f]{64}$/.test(k)) out.add(k);
  }
  return out;
}
