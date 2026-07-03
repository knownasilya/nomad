import { z } from 'zod'

export const CommentSchema = z.object({
  type: z.literal('walled.garden/comment'),
  topic: z.url(),
  replyTo: z.url().optional(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional()
})

export type Comment = z.infer<typeof CommentSchema>
