import { z } from 'zod'

export const ReactionSchema = z.object({
  type: z.literal('walled.garden/reaction'),
  topic: z.url(),
  phrases: z.array(z.string().max(20).regex(/^[a-z ]+$/))
})
