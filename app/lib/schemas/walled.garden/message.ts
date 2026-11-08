import { z } from 'zod';
import { VouchSchema } from './vouch.ts';

// A direct message from one Persona to another (ADR-0036 §5). It travels sealed to the recipient's
// inbox box key and is stored in each side's Vault. Text only: nothing in it makes the reader's
// browser load anything, so a Message can't carry a tracking pixel or a read receipt.
export const MessageSchema = z
  .object({
    type: z.literal('walled.garden/message'),
    // 16 random bytes, base32.
    id: z.string().min(16).max(40),
    // The sender's Profile Drive, hyper://<key>/
    from: z.url(),
    // The recipient's Profile Drive.
    to: z.url(),
    createdAt: z.iso.datetime(),
    // Plain text; links are shown, never fetched. Empty only when the Message carries a Vouch.
    text: z.string().max(8000),
    // Another Message id in the Conversation.
    inReplyTo: z.string().max(40).optional(),
    // A Vouch the sender gives the recipient (ADR-0045): its host is `from` and its guest `to`.
    vouch: VouchSchema.optional(),
  })
  .strict()
  .refine((m) => m.text.length > 0 || !!m.vouch, { message: 'A Message needs text or a Vouch' })
  .refine((m) => !m.vouch || (m.vouch.host === m.from && m.vouch.guest === m.to), {
    message: 'A Vouch rides from its host to its guest',
  });

export type Message = z.infer<typeof MessageSchema>;
