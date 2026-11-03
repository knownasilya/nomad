import { z } from 'zod';

export const PersonSchema = z.object({
  type: z.literal('walled.garden/person'),
  title: z.string().max(280),
  description: z.string().max(1000).optional(),
  thumb: z.string().optional(),
  links: z
    .array(
      z.object({
        label: z.string().max(100),
        href: z.url(),
      })
    )
    .optional(),
  // The Persona Inbox's public keys (ADR-0036 §3): `sign` checks what this Persona sends; `box`
  // and `mailboxes` (one per Device) are where to send it a message. Only `sign` unless the
  // Persona takes messages from anyone.
  inbox: z
    .object({
      v: z.literal(1),
      sign: z.string().regex(/^[0-9a-f]{64}$/),
      box: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
      mailboxes: z
        .array(z.string().regex(/^[0-9a-f]{64}$/))
        .max(8)
        .optional(),
    })
    .optional(),
});

export type Person = z.infer<typeof PersonSchema>;
