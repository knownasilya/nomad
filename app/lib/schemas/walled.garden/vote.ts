import { z } from 'zod';

export const VoteSchema = z.object({
  type: z.literal('walled.garden/vote'),
  topic: z.url(),
  vote: z.union([z.literal(-1), z.literal(1)]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional(),
});

export type Vote = z.infer<typeof VoteSchema>;
