import { z } from 'zod'

export const PostSchema = z.object({
  type: z.literal('walled.garden/post'),
  title: z.string().max(280),
  body: z.string(),
  category: z.string().max(100).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  author: z.object({
    url: z.string().url().nullish(),
    writerKey: z.string().optional()
  }).optional()
})
