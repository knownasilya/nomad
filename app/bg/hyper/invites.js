// @ts-nocheck
//
// Invite links on desktop (ADR-0040): making a Space's invite link, reading one a friend sent, and
// taking one in from the OS (`nomad-invite:`) or a tab (an https://nomad.pages.dev/invite/ link).
// The payload, its signature and the records are shared/invites.mjs; the Space side (the
// blind-pairing invite, the Vault record, joins) is bg/hyper/space-library.js.
//
// Who calls in: nomad.vault (web-apis/bg/vault.ts) for My Library → Sharing; main.js for links
// from the OS; ui/tabs/pane.js for a tab that goes to an invite link. No page API makes, reads or
// accepts invites, and the AI has no capability for them (§7).

import b4a from 'b4a';
import sodium from 'sodium-universal';
import * as logLib from '../logger';
import * as spaceLibrary from './space-library';
import * as inbox from './inbox';
import * as personas from '../ui/personas';
import * as inv from '../../../shared/invites.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'invites' });

// The page that opens an invite: My Library → Sharing, with the payload in the fragment. The page
// only shows it (through `read`) and joins on the user's click; nothing runs from the URL.
export const ACCEPT_PAGE = 'nomad://library/sharing';

// The page to open for `url` when it's an invite link (either form), else null.
export function acceptUrlFor(url) {
  if (!inv.isInviteLink(url)) return null;
  const payload = inv.payloadText(url);
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  return `${ACCEPT_PAGE}#invite=${payload}`;
}

// Make an invite link for the Space with Root Drive key `space`, signed by its Persona when that
// Persona can send (ADR-0036 §7.3: its profile's writers are the user's Devices).
export async function makeSpaceLink(space, role, { days } = {}) {
  await personas.ensureLoaded().catch(() => {});
  const p = personas.personaForSpaceKey(space);
  let persona = null;
  if (p && personas.isUsable(p.id)) {
    const manifest = await personas.readProfileManifest(p.profileUrl).catch(() => null);
    persona = { id: p.id, profileUrl: p.profileUrl, title: String(manifest?.title || '').trim() };
    if (!persona.title) persona = null; // nothing honest to show as the sender
  }
  const out = await spaceLibrary.inviteLink(space, role, {
    days,
    persona,
    sign: persona ? (id, bytes) => inbox.signInvite(id, bytes) : null,
  });
  logger.info('Made an invite link', { space, role, signed: out.signed });
  return out;
}

function verify(sig, msg, publicKey) {
  return sodium.crypto_sign_verify_detached(b4a.from(sig), b4a.from(msg), b4a.from(publicKey));
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// What the accept screen shows for a link (ADR-0040 §4):
//   { title, role, from: { url, name, profileTitle, nameDiffers } | null, check, expired, expiresAt,
//     space: { name, role } | null }
// `check` is 'ok', 'unknown' (couldn't reach their profile yet) or 'unsigned'. A changed invite
// throws, so it can't be joined.
export async function read(link) {
  const invite = inv.parseInviteLink(link);
  const expired = inv.isExpired(invite);
  let check = 'unsigned';
  let from = null;
  if (invite.signed) {
    const url = `hyper://${invite.from}/`;
    const [sign, manifest] = await Promise.all([
      withTimeout(inbox.publishedSign(url).catch(() => null), 15000),
      withTimeout(personas.readProfileManifest(url).catch(() => null), 15000),
    ]);
    check = inv.signatureState(invite, sign, verify);
    if (check === 'bad') throw new Error('This invite has been changed. Ask for a new one.');
    const profileTitle = String(manifest?.title || '').trim();
    from = {
      url,
      name: invite.name,
      profileTitle,
      nameDiffers: !!profileTitle && profileTitle !== invite.name,
    };
  }
  const words = inv.describeInvite(invite);
  return {
    ...words,
    from,
    check,
    expired,
    expiresAt: invite.expiresAt,
    space: invite.space ? { name: invite.space.name, role: invite.space.role } : null,
  };
}

// The Space code inside an invite link, after the checks `read` makes (expiry, signature). Joining
// with a bare code is unchanged.
export async function codeFor(input) {
  if (!inv.isInviteLink(input) && !inv.payloadText(input)?.startsWith('AQ')) return String(input || '').trim();
  const invite = inv.parseInviteLink(input);
  if (!invite.space) throw new Error('This invite isn’t for a Space');
  if (inv.isExpired(invite)) throw new Error('This invite has run out. Ask for a new one.');
  if (invite.signed) {
    const sign = await withTimeout(inbox.publishedSign(`hyper://${invite.from}/`).catch(() => null), 15000);
    if (inv.signatureState(invite, sign, verify) === 'bad')
      throw new Error('This invite has been changed. Ask for a new one.');
  }
  return invite.space.code;
}
