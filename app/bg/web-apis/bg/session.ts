// nomad.session (public): a page asks "who are you?" and the browser answers with one of the user's
// Personas, only after the user says yes in the login prompt (ADR-0031 §7–10).
//
//   requestLogin({ perms?, maxAge? })  the prompt; resolves to the Session, or rejects with
//                                      UserDeniedError on a cancel, a "no", or no Persona at all
//   getCurrent()                       the Session the prompt already made, or null. Never a prompt.
//   revoke()                           the page logs itself out
//   'change' event                     the Session changed: revoked here or on another Device, its
//                                      Persona switched or deleted. The page decides what to do.
//
// There is no silent path: only the prompt makes a Session, and a trusted sender gets no shortcut
// (a nomad:// page that needs a Persona uses nomad.personas). Records and rules: bg/ui/personas.js.

import emitStream from 'emit-stream';
import { EventEmitter } from 'events';
import { PermissionsError, UserDeniedError } from 'beaker-error-constants';
import * as personas from '../../ui/personas';
import * as modals from '../../ui/subwindows/modals';
import * as filesystem from '../../filesystem/index';
import * as autobases from '../../hyper/autobases';
import * as drives from '../../hyper/drives';
import * as spacesDb from '../../dbs/spaces';
import * as P from '../../../../shared/personas.mjs';

// webContents id -> how long the "no" took, until the page navigates. Within one page load a second
// requestLogin() after a "no" rejects without a prompt, after the same delay.
const denied = new Map<number, number>();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spaceIdOf(ctx) {
  return Number(ctx?.sender ? filesystem.getSpaceIdForWebContents(ctx.sender.id) : null) || 1;
}

function pageUrl(ctx) {
  try {
    return ctx.sender.getURL();
  } catch {
    return '';
  }
}

function rememberDenial(sender, tookMs) {
  if (denied.has(sender.id)) return;
  denied.set(sender.id, Math.min(4000, Math.max(800, tookMs)));
  const clear = () => denied.delete(sender.id);
  sender.once('did-navigate', clear);
  sender.once('destroyed', clear);
}

// Who is asking (§7.3): for a drive, its title and thumb read by bg itself, with its key shown next
// to them so a long or look-alike title can't pass for another site; for the web, its host.
async function siteIdentity(url, origin) {
  const key = P.driveKeyOf(`${origin}/`);
  if (!key) {
    const u = new URL(url);
    return { kind: 'web', host: u.host, secure: u.protocol === 'https:', origin, icon: `asset:favicon:${origin}/` };
  }
  let title = '';
  try {
    const sess = autobases.getCollaborativeDrive(key);
    const manifest = sess ? await autobases.readJson(sess, '/index.json') : null;
    title = String(manifest?.title || '');
  } catch {}
  if (!title) {
    const info: any = await drives.getDriveInfo(key, { onlyCache: true }).catch(() => null);
    title = String(info?.title || '');
  }
  return { kind: 'drive', key, title: title.slice(0, 200), origin, icon: `asset:favicon:${origin}/` };
}

export default {
  async requestLogin(opts: any = {}) {
    const sender = this.sender;
    const url = pageUrl(this);
    const origin = P.sessionOrigin(url);
    if (!origin) throw new PermissionsError('Only http(s):// sites and hyper:// drives (by key) can ask you to log in');
    const o = opts && typeof opts === 'object' ? opts : {};
    // A drive author's mistakes fail at once, before any prompt.
    P.requestedPerms((o.perms ?? []).map?.((p) => String(p).split(':')[0]) ?? o.perms, null);
    const maxAge = P.normalizeMaxAge(o.maxAge);
    const spaceId = spaceIdOf(this);

    if (denied.has(sender.id)) {
      await sleep(denied.get(sender.id));
      throw new UserDeniedError();
    }

    // Logged in already, with everything asked: that Session. It's the one the prompt made.
    const current = personas.sessionFor(url, spaceId);
    if (current) {
      const p = personas.get(current.personaId);
      const want = P.requestedPerms(o.perms, P.driveKeyOf(p?.profileUrl));
      if (want.every((t) => current.perms.includes(t))) return personas.sessionViewFor(url, spaceId);
    }

    const choices = await personas.loginChoices(spaceId);
    const space = spacesDb.getCachedAll().find((s) => s.id === spaceId);
    const started = Date.now();
    let res: any = null;
    try {
      res = await modals.create(sender, 'persona-login', {
        site: await siteIdentity(url, origin),
        personas: choices.personas,
        pickedId: choices.pickedId,
        perms: [...new Set((o.perms || []).map((p) => String(p).split(':')[0]))],
        space: { name: space?.name || 'Personal', color: space?.color || '#6c6cff' },
        vaultReady: choices.vaultReady || !choices.hasVault,
      });
    } catch (e) {
      if (e?.name === 'ModalActiveError') throw e;
      res = null;
    }
    if (!res || !res.allow) {
      rememberDenial(sender, Date.now() - started);
      throw new UserDeniedError();
    }

    let personaId = res.personaId;
    if (res.create) personaId = (await personas.create({ label: res.create.label, title: res.create.title })).id;
    const p = personas.get(personaId);
    if (!p || !personas.isUsable(personaId)) throw new PermissionsError('That Persona can’t log in right now. See My Library → Personas.');
    const spaceKey = personas.spaceKeyOf(spaceId);
    if (!spaceKey) throw new Error('This Space isn’t ready yet. Try again in a moment.');

    // One Session per site in a Space (§8): logging in as another Persona switches the Space's.
    const resolved = personas.personaForSpaceKey(spaceKey);
    if (!resolved) await personas.setDefault(personaId);
    else if (resolved.id !== personaId) await personas.setSpacePersona(spaceId, personaId);

    const key = P.driveKeyOf(p.profileUrl);
    const requested = P.requestedPerms(o.perms, key);
    const perms = P.grantedPerms(requested, P.requestedPerms(Array.isArray(res.perms) ? res.perms : [], key));
    await personas.grant({ origin, spaceKey, personaId, perms, maxAge });
    return personas.sessionViewFor(url, spaceId);
  },

  async getCurrent() {
    return personas.sessionViewFor(pageUrl(this), spaceIdOf(this));
  },

  async revoke() {
    await personas.endSessionFor(pageUrl(this), spaceIdOf(this));
  },

  createEventStream() {
    const sender = this.sender;
    const spaceId = spaceIdOf(this);
    const emitter = new EventEmitter();
    let last = JSON.stringify(personas.sessionViewFor(pageUrl(this), spaceId));
    const changed = () => {
      if (sender.isDestroyed()) return;
      const view = personas.sessionViewFor(sender.getURL(), spaceId);
      const next = JSON.stringify(view);
      if (next === last) return;
      last = next;
      emitter.emit('change', { session: view });
    };
    personas.events.on('changed', changed);
    // A new page load makes its own stream.
    const stop = () => {
      personas.events.removeListener('changed', changed);
      sender.removeListener('did-navigate', stop);
      sender.removeListener('destroyed', stop);
    };
    sender.once('did-navigate', stop);
    sender.once('destroyed', stop);
    const stream = emitStream(emitter);
    stream.on('close', stop);
    return stream;
  },
};
