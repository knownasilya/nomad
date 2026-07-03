import { z } from 'zod'

export const FollowsSchema = z.object({
  type: z.literal('walled.garden/follows'),
  urls: z.array(z.url())
})

export type Follows = z.infer<typeof FollowsSchema>
