import { z } from 'zod'

export const StatusSchema = z.object({
  type: z.literal('walled.garden/status'),
  body: z.string().max(1000000),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional()
})

export type Status = z.infer<typeof StatusSchema>
