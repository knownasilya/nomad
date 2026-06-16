import { z } from 'zod'

export const VoteSchema = z.object({
  type: z.literal('walled.garden/vote'),
  topic: z.string().url(),
  vote: z.union([z.literal(-1), z.literal(1)]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
})
