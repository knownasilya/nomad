import { z } from 'zod';

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
    // Plain text; links are shown, never fetched.
    text: z.string().min(1).max(8000),
    // Another Message id in the Conversation.
    inReplyTo: z.string().max(40).optional(),
  })
  .strict();

export type Message = z.infer<typeof MessageSchema>;
