import { z } from 'zod'

export const CommentSchema = z.object({
  type: z.literal('walled.garden/comment'),
  topic: z.string().url(),
  replyTo: z.string().url().optional(),
  body: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
})
