// Pure, dependency-injected permission gate for cross-drive writes on Autobase drives (the backend
// used by every drive since ADR-0010, "Autobase from birth"). hyperdrive.ts's assertWritePermission
// already gates the legacy Hyperdrive backend the same way; Autobase had no equivalent, so any loaded
// page that merely knew another drive's URL could silently write its files or manage its writers.
// This closes that gap with the SAME modifyDrive permission the Hyperdrive path already prompts for.
//
// Same DI shape as fs-router.ts (every collaborator injected, nothing imported except the error type)
// so it's unit-testable without Electron. See tests/unit/fs-write-guard.test.js.
//
// Injected deps:
//   isWcTrusted(sender)         — true for a trusted nomad:// UI (bypasses the prompt entirely)
//   senderDriveKey(sender)      — hex key of the sender's OWN origin drive, or null/false
//   getTitle(baseKey)           — display title for the target drive, for the prompt copy
//   requestPermission(permId, sender, opts) — prompts the user, resolves a boolean decision
//   queryPermission(permId, sender)         — resolves a previously-persisted decision, or falsy
import { UserDeniedError } from 'beaker-error-constants';

export function createFsWriteGuard(deps) {
  const { isWcTrusted, senderDriveKey, getTitle, requestPermission, queryPermission } = deps;

  async function assert(permId, ctx, baseKey) {
    const sender = ctx?.sender;
    if (!sender) return; // no sender context (internal/direct callers) — nothing to gate

    if (isWcTrusted(sender)) return;

    // The AI's writeDriveFile asks the user for this drive itself, once a turn (bg/ai/vault-tools.mjs
    // askOncePerTurn), or holds a Job's grant, or made the drive on this turn. Its yes covers this
    // write; asking again here would prompt twice, or refuse a turn with no window to ask in (a Job,
    // the phone over the Bridge). Only main-process code builds this ctx: an RPC call's ctx is the
    // server's { sender }.
    if (permId === 'modifyDrive' && ctx.approvedDrive && ctx.approvedDrive === baseKey) return;

    const ownKey = await senderDriveKey(sender);
    if (ownKey && ownKey === baseKey) return; // writing/managing your own drive is always free

    const perm = `${permId}:${baseKey}`;
    if (await queryPermission(perm, sender)) return; // previously granted

    const title = await getTitle(baseKey);
    const allowed = await requestPermission(perm, sender, { title });
    if (!allowed) throw new UserDeniedError();
  }

  return {
    assertWrite: (ctx, baseKey) => assert('modifyDrive', ctx, baseKey),
    assertManage: (ctx, baseKey) => assert('manageDriveWriters', ctx, baseKey),
  };
}
