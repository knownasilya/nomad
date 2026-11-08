import { z } from 'zod';

// A Vouch (ADR-0045): one Profile Drive (the host) says it has had another (the guest) over at home,
// with an optional note. Nothing in it says where, when or how often, and there are no ratings and
// no negative kind. It shows nowhere until the guest accepts it, and it is valid while the host's
// drive lists its hash (`walled.garden/vouch-index`) and `expiresAt` hasn't passed. Not proof of
// personhood: it says "the writers of this Profile Drive say so".
export const VouchSchema = z
  .object({
    type: z.literal('walled.garden/vouch'),
    v: z.literal(1),
    // 16 random bytes, base32: the hash of the record can't be guessed back to its guest.
    id: z.string().regex(/^[a-z2-7]{16,40}$/),
    kind: z.literal('hosted'),
    // The host's Profile Drive, hyper://<key>/
    host: z.url(),
    // The guest's Profile Drive.
    guest: z.url(),
    // Plain text, shown, never rendered or fetched.
    note: z.string().min(1).max(280).optional(),
    issuedAt: z.iso.datetime(),
    // At most a year after issuedAt.
    expiresAt: z.iso.datetime(),
  })
  .strict();

export type Vouch = z.infer<typeof VouchSchema>;

// /.data/walled.garden/vouches-given.json in the host's Profile Drive: the hex sha256 of the
// canonical JSON (keys sorted at every level) of every Vouch the host still stands behind. A Vouch
// the list doesn't name is withdrawn.
export const VouchIndexSchema = z
  .object({
    type: z.literal('walled.garden/vouch-index'),
    v: z.literal(1),
    hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .strict();

export type VouchIndex = z.infer<typeof VouchIndexSchema>;

// /.data/walled.garden/vouches.json in the guest's Profile Drive: the Vouches the guest chose to
// show on their profile. A reader keeps only the ones whose `guest` is this drive.
export const VouchesSchema = z
  .object({
    type: z.literal('walled.garden/vouches'),
    v: z.literal(1),
    items: z.array(VouchSchema),
  })
  .strict();

export type Vouches = z.infer<typeof VouchesSchema>;
